import type { PrismaClient } from "@/generated/prisma/client";
import { defaultStake } from "./profit";

/** Matches that started longer ago than this aren't filled in any more. */
const LOOKBACK_MS = 24 * 60 * 60_000;

/**
 * Bets are often not recorded by hand: once a match with a pick (e.g. the
 * "1.5U OVER" badge) has started with no bet recorded, and its alarm wasn't
 * skipped or cancelled, the pick becomes the bet (units and odds from the
 * upload) and the match moves to Pending. The bet stays marked autoFilled
 * until it's changed or a scanned bet slip of the match replaces it.
 * Accounts can turn this off in Settings. Returns how many were filled in.
 */
export async function autoFillBets(prisma: PrismaClient, now = new Date()): Promise<number> {
  const matches = await prisma.match.findMany({
    where: {
      startsAt: { lte: now, gt: new Date(now.getTime() - LOOKBACK_MS) },
      bet: { is: null },
      statistics: { is: { selection: { not: null } } },
      alarm: { is: { ackAt: null, status: { in: ["TRIGGERED", "COMPLETED", "FAILED"] } } },
      user: { is: { OR: [{ settings: { is: null } }, { settings: { is: { autoRecordBets: true } } }] } },
    },
    select: { id: true, startsAt: true, stakeUnits: true, odds: true, playType: true },
    take: 500,
  });
  if (!matches.length) return 0;
  // skipDuplicates: a bet recorded meanwhile is kept.
  const created = await prisma.bet.createMany({
    data: matches.map((m) => ({ matchId: m.id, stake: defaultStake(m.stakeUnits, m.playType), odds: m.odds, placedAt: m.startsAt, autoFilled: true })),
    skipDuplicates: true,
  });
  await prisma.alarm.updateMany({
    where: { matchId: { in: matches.map((m) => m.id) }, ackAt: null },
    data: { ackAt: now, ackAction: "placed", nextRepeatAt: null },
  });
  return created.count;
}

const state = globalThis as unknown as { __ttLastAutoFill?: number };

/** At most once a minute per server instance (called from the alarm checker). */
export async function autoFillBetsIfDue(prisma: PrismaClient, now = new Date()): Promise<void> {
  if (now.getTime() - (state.__ttLastAutoFill ?? 0) < 60_000) return;
  state.__ttLastAutoFill = now.getTime();
  try {
    const n = await autoFillBets(prisma, now);
    if (n) console.log(`[bets] filled in ${n} bet(s) from the matches' picks`);
  } catch (err) {
    console.error("[bets] filling in bets failed", err);
  }
}
