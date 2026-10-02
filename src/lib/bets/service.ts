import type { Bet, PrismaClient } from "@/generated/prisma/client";
import { ServiceError } from "@/lib/alarms/service-error";
import { combineLegs, computeProfit, defaultStake, round2, type BetResult } from "./profit";
import type { BetInput, BetLegInput } from "@/lib/validation/match";
import type { Selection } from "@/lib/selection";

interface Leg {
  selection: Selection;
  stake: number;
  odds: number | null;
  result: BetResult;
}

/**
 * Record that a bet was placed on a match (idempotent: an existing bet is
 * kept, and only the given fields are updated). `legs` splits it over
 * several picks, e.g. 0.5u UNDER + 0.5u SWEEP.
 */
export async function placeBet(
  prisma: PrismaClient,
  userId: string,
  matchId: string,
  input: { stake?: number; odds?: number | null; legs?: BetLegInput[] },
  now = new Date(),
): Promise<Bet> {
  const match = await prisma.match.findFirst({ where: { id: matchId, userId }, select: { stakeUnits: true, odds: true, bet: true } });
  if (!match) throw new ServiceError("Match not found.", 404, "not_found");
  if (match.bet) {
    return updateBet(prisma, userId, matchId, { stake: input.stake, odds: input.odds, legs: input.legs });
  }
  if (input.legs?.length) {
    const legs = toLegs(input.legs, []);
    const totals = combineLegs(legs);
    return prisma.bet.create({
      data: {
        matchId,
        stake: totals.stake,
        odds: null,
        result: totals.result,
        profit: totals.profit,
        placedAt: now,
        settledAt: totals.result === "PENDING" ? null : now,
        legs: { create: legs.map((l, position) => ({ position, ...l, profit: computeProfit(l.stake, l.odds, l.result) })) },
      },
    });
  }
  // Defaults are the stake (units) and odds filled in when the match was uploaded.
  const stake = input.stake ?? defaultStake(match.stakeUnits);
  const odds = input.odds !== undefined ? input.odds : match.odds;
  return prisma.bet.create({ data: { matchId, stake, odds: odds ?? null, placedAt: now } });
}

/**
 * Edit stake/odds, split or unsplit the bet, or settle it (or one pick of a
 * split bet). Profit and, for split bets, the totals are recomputed every time.
 */
export async function updateBet(prisma: PrismaClient, userId: string, matchId: string, input: BetInput, now = new Date()): Promise<Bet> {
  const owned = await prisma.match.count({ where: { id: matchId, userId } });
  if (!owned) throw new ServiceError("Match not found.", 404, "not_found");
  const bet = await prisma.bet.findUnique({ where: { matchId }, include: { legs: { orderBy: { position: "asc" } } } });
  if (!bet) {
    // Settling a bet that was never confirmed via the alarm: record it first
    // (the stake defaults like "I've placed the bet" does).
    await placeBet(prisma, userId, matchId, { stake: input.stake, odds: input.odds, legs: input.legs ?? undefined }, now);
    return input.result || input.leg
      ? updateBet(prisma, userId, matchId, { result: input.result, leg: input.leg }, now)
      : prisma.bet.findUniqueOrThrow({ where: { matchId } });
  }

  const current: Leg[] = bet.legs.map((l) => ({ selection: l.selection as Selection, stake: l.stake, odds: l.odds, result: l.result as BetResult }));
  let legs = input.legs === null ? [] : input.legs ? toLegs(input.legs, current) : current;
  if (input.leg) {
    if (!legs[input.leg.index]) throw new ServiceError("That pick doesn't exist on this bet.", 400, "invalid_leg");
    legs = legs.map((l, i) => (i === input.leg!.index ? { ...l, result: input.leg!.result } : l));
  } else if (input.result && !input.legs) {
    legs = legs.map((l) => ({ ...l, result: input.result! }));
  }

  if (legs.length) {
    const totals = combineLegs(legs);
    return prisma.$transaction(async (tx) => {
      await tx.betLeg.deleteMany({ where: { betId: bet.id } });
      await tx.betLeg.createMany({
        data: legs.map((l, position) => ({ betId: bet.id, position, ...l, profit: computeProfit(l.stake, l.odds, l.result) })),
      });
      return tx.bet.update({
        where: { id: bet.id },
        data: {
          stake: totals.stake,
          odds: null,
          result: totals.result,
          profit: totals.profit,
          settledAt: totals.result === "PENDING" ? null : bet.settledAt ?? now,
        },
      });
    });
  }

  // A single bet (or a split bet being turned back into one).
  const unsplit = current.length > 0;
  const stake = input.stake ?? bet.stake;
  const odds = input.odds !== undefined ? input.odds : bet.odds;
  const result = (input.result ?? (unsplit ? "PENDING" : bet.result)) as BetResult;
  return prisma.$transaction(async (tx) => {
    if (unsplit) await tx.betLeg.deleteMany({ where: { betId: bet.id } });
    return tx.bet.update({
      where: { matchId },
      data: {
        stake,
        odds,
        result,
        profit: computeProfit(stake, odds, result),
        settledAt: result === "PENDING" ? null : bet.settledAt ?? now,
      },
    });
  });
}

/** New picks from the editor; a pick keeps its result unless one is given. */
function toLegs(input: BetLegInput[], current: Leg[]): Leg[] {
  return input.map((l, i) => ({
    selection: l.selection,
    stake: round2(l.stake),
    odds: l.odds ?? null,
    result: l.result ?? (current[i]?.selection === l.selection ? current[i].result : "PENDING"),
  }));
}

export async function deleteBet(prisma: PrismaClient, userId: string, matchId: string) {
  await prisma.bet.deleteMany({ where: { matchId, match: { userId } } });
}
