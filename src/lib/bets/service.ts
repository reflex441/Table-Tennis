import type { Bet, PrismaClient } from "@/generated/prisma/client";
import { ServiceError } from "@/lib/alarms/service-error";
import { computeProfit, defaultStake, effectiveOdds, type BetResult, type OddsPolicy } from "./profit";
import type { BetInput } from "@/lib/validation/match";

/**
 * Record that a bet was placed on a match (idempotent: an existing bet is
 * kept, and only the given fields are updated).
 */
export async function placeBet(prisma: PrismaClient, matchId: string, input: { stake?: number; odds?: number | null }, now = new Date()): Promise<Bet> {
  const match = await prisma.match.findUnique({ where: { id: matchId }, select: { playType: true, stakeUnits: true, bet: true } });
  if (!match) throw new ServiceError("Match not found.", 404, "not_found");
  if (match.bet) {
    return updateBet(prisma, matchId, { stake: input.stake, odds: input.odds });
  }
  // Stake in units; defaults to the badge units for bot plays.
  const stake = input.stake ?? defaultStake(match.playType, match.stakeUnits);
  return prisma.bet.create({ data: { matchId, stake, odds: input.odds ?? null, placedAt: now } });
}

/** Edit stake/odds or settle the bet; profit is recomputed every time. */
export async function updateBet(prisma: PrismaClient, matchId: string, input: BetInput, now = new Date()): Promise<Bet> {
  const bet = await prisma.bet.findUnique({ where: { matchId } });
  if (!bet) {
    // Settling a bet that was never confirmed via the alarm: record it first
    // (the stake defaults like "I've placed the bet" does).
    await placeBet(prisma, matchId, { stake: input.stake, odds: input.odds }, now);
    return input.result ? updateBet(prisma, matchId, { result: input.result }, now) : prisma.bet.findUniqueOrThrow({ where: { matchId } });
  }
  const stake = input.stake ?? bet.stake;
  const odds = input.odds !== undefined ? input.odds : bet.odds;
  const result = (input.result ?? bet.result) as BetResult;
  const policy = await oddsPolicy(prisma);
  return prisma.bet.update({
    where: { matchId },
    data: {
      stake,
      odds,
      result,
      profit: computeProfit(stake, effectiveOdds(odds, policy), result),
      settledAt: result === "PENDING" ? null : bet.settledAt ?? now,
    },
  });
}

export async function deleteBet(prisma: PrismaClient, matchId: string) {
  await prisma.bet.deleteMany({ where: { matchId } });
}

async function oddsPolicy(prisma: PrismaClient): Promise<OddsPolicy> {
  const s = await prisma.settings.findUnique({ where: { id: 1 }, select: { useAverageOdds: true, averageOdds: true } });
  return { useAverageOdds: s?.useAverageOdds ?? false, averageOdds: s?.averageOdds ?? 1.85 };
}

/**
 * Re-price won bets after the average-odds setting changes. Only bets with
 * no odds of their own are affected; bets with odds always keep them.
 */
export async function recomputeProfits(prisma: PrismaClient): Promise<number> {
  const policy = await oddsPolicy(prisma);
  const bets = await prisma.bet.findMany({ where: { result: "WON", odds: null }, select: { id: true, stake: true, odds: true, profit: true } });
  const changes = bets
    .map((b) => ({ id: b.id, profit: computeProfit(b.stake, effectiveOdds(b.odds, policy), "WON") }))
    .filter((c, i) => c.profit !== bets[i].profit);
  if (changes.length) {
    await prisma.$transaction(changes.map((c) => prisma.bet.update({ where: { id: c.id }, data: { profit: c.profit } })));
  }
  return changes.length;
}
