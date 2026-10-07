import type { Bet, PrismaClient } from "@/generated/prisma/client";
import { ServiceError } from "@/lib/alarms/service-error";
import { combineLegs, computeProfit, defaultStake, round2, type BetResult } from "./profit";
import type { BetInput, BetLegInput, PastBetInput } from "@/lib/validation/match";
import { matchDedupeKey } from "@/lib/matching/dedupe";
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

/**
 * Record a bet on a match that has already been played (for the Profit
 * page). It gets no alarm: the match is stored as finished with the bet
 * placed, so it shows in Pending (result not known yet) or Completed.
 */
export async function createPastBet(
  prisma: PrismaClient,
  userId: string,
  input: PastBetInput,
  now = new Date(),
): Promise<{ matchId: string; combined: boolean }> {
  const startsAt = new Date(input.startsAt);
  if (startsAt.getTime() > now.getTime()) {
    throw new ServiceError("That match hasn't started yet - add upcoming matches with Upload or Manual so you get the alarm.", 422, "not_past");
  }
  const dedupeKey = matchDedupeKey(input.player1, input.player2, startsAt);
  const existing = await prisma.match.findUnique({ where: { userId_dedupeKey: { userId, dedupeKey } }, select: { id: true } });
  if (existing) return { matchId: existing.id, combined: await addPickToMatch(prisma, userId, existing.id, input, now) };
  const result = input.result as BetResult;
  const match = await prisma.match.create({
    data: {
      userId,
      player1: input.player1,
      player2: input.player2,
      competition: input.competition,
      startsAt,
      timezone: input.timezone,
      dedupeKey,
      playType: input.playType,
      stakeUnits: input.stake,
      odds: input.odds,
      statistics: { create: { selection: input.selection, pointsLine: input.pointsLine } },
      // A finished alarm, already confirmed as placed: never rings.
      alarm: {
        create: { reminderMinutes: 0, fireAt: startsAt, nextAttemptAt: startsAt, status: "COMPLETED", completedAt: now, ackAt: now, ackAction: "placed" },
      },
      bet: {
        create: {
          stake: input.stake,
          odds: input.odds,
          result,
          profit: computeProfit(input.stake, input.odds, result),
          placedAt: startsAt,
          settledAt: result === "PENDING" ? null : now,
        },
      },
    },
    select: { id: true },
  });
  return { matchId: match.id, combined: false };
}

/**
 * A second bet on a match you already have, on a different pick (e.g. an
 * UNDER and a SWEEP on the same game): both become picks of one split bet,
 * each with its own units, odds and result. The same pick twice is refused.
 */
async function addPickToMatch(prisma: PrismaClient, userId: string, matchId: string, input: PastBetInput, now: Date): Promise<true> {
  const match = await prisma.match.findFirstOrThrow({
    where: { id: matchId, userId },
    select: { statistics: { select: { selection: true } }, bet: { select: { stake: true, odds: true, result: true, legs: { orderBy: { position: "asc" } } } } },
  });
  const pick = input.selection;
  const duplicate = () => new ServiceError("You already have this bet (same match, same pick).", 409, "duplicate", { existingId: matchId });
  const newLeg = { selection: pick!, stake: input.stake, odds: input.odds, result: input.result as BetResult };

  if (!match.bet) {
    // The match is there (e.g. added for an alarm) but has no bet yet.
    await updateBet(prisma, userId, matchId, { stake: input.stake, odds: input.odds, result: input.result as BetResult }, now);
    return true;
  }
  if (!pick) throw duplicate();
  const legs = match.bet.legs.length
    ? match.bet.legs.map((l) => ({ selection: l.selection as Selection, stake: l.stake, odds: l.odds, result: l.result as BetResult }))
    : match.statistics?.selection
      ? [{ selection: match.statistics.selection as Selection, stake: match.bet.stake, odds: match.bet.odds, result: match.bet.result as BetResult }]
      : null;
  if (!legs || legs.some((l) => l.selection === pick)) throw duplicate();
  if (legs.length >= 3) throw new ServiceError("This match already has 3 picks.", 409, "too_many_picks");
  await updateBet(prisma, userId, matchId, { legs: [...legs, newLeg] }, now);
  return true;
}
