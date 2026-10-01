import type { Bet, PrismaClient } from "@/generated/prisma/client";
import { ServiceError } from "@/lib/alarms/service-error";
import { computeProfit, defaultStake, type BetResult } from "./profit";
import type { BetInput } from "@/lib/validation/match";

/**
 * Record that a bet was placed on a match (idempotent: an existing bet is
 * kept, and only the given fields are updated).
 */
export async function placeBet(prisma: PrismaClient, matchId: string, input: { stake?: number; odds?: number | null }, now = new Date()): Promise<Bet> {
  const match = await prisma.match.findUnique({ where: { id: matchId }, select: { stakeUnits: true, odds: true, bet: true } });
  if (!match) throw new ServiceError("Match not found.", 404, "not_found");
  if (match.bet) {
    return updateBet(prisma, matchId, { stake: input.stake, odds: input.odds });
  }
  // Defaults are the stake (units) and odds filled in when the match was uploaded.
  const stake = input.stake ?? defaultStake(match.stakeUnits);
  const odds = input.odds !== undefined ? input.odds : match.odds;
  return prisma.bet.create({ data: { matchId, stake, odds: odds ?? null, placedAt: now } });
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
  return prisma.bet.update({
    where: { matchId },
    data: {
      stake,
      odds,
      result,
      profit: computeProfit(stake, odds, result),
      settledAt: result === "PENDING" ? null : bet.settledAt ?? now,
    },
  });
}

export async function deleteBet(prisma: PrismaClient, matchId: string) {
  await prisma.bet.deleteMany({ where: { matchId } });
}
