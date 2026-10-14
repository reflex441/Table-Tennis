import type { PrismaClient } from "@/generated/prisma/client";

/**
 * A match you didn't bet on is deleted once it started this long ago and
 * nothing changed on it since. Long enough to scan the bet slips first: a
 * slip needs the match to tell a bot play from a personal one.
 */
export const IDLE_MATCH_HOURS = 72;

/**
 * Keeps the dashboard tidy: matches whose alarm is over (done, cancelled or
 * failed) with no bet registered go 3 days after they started, unless
 * edited in that time. "No bet" includes an auto-filled bet that was never
 * confirmed (no slip scanned, not settled or edited). Bets you registered
 * are never deleted: they're the profit history.
 */
export async function deleteIdleMatches(prisma: PrismaClient, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - IDLE_MATCH_HOURS * 3_600_000);
  const res = await prisma.match.deleteMany({
    where: {
      startsAt: { lt: cutoff },
      updatedAt: { lt: cutoff },
      AND: [
        { OR: [{ bet: { is: null } }, { bet: { is: { autoFilled: true, result: "PENDING" } } }] },
        { OR: [{ alarm: { is: null } }, { alarm: { is: { status: { in: ["COMPLETED", "CANCELLED", "FAILED"] }, updatedAt: { lt: cutoff } } } }] },
      ],
    },
  });
  return res.count;
}

const state = globalThis as unknown as { __ttLastIdleCleanup?: number };

/** At most once an hour per server instance (called from the alarm checker). */
export async function deleteIdleMatchesIfDue(prisma: PrismaClient, now = new Date()): Promise<void> {
  if (now.getTime() - (state.__ttLastIdleCleanup ?? 0) < 60 * 60_000) return;
  state.__ttLastIdleCleanup = now.getTime();
  try {
    const n = await deleteIdleMatches(prisma, now);
    if (n) console.log(`[matches] deleted ${n} finished match(es) with no bet registered`);
  } catch (err) {
    console.error("[matches] cleanup failed", err);
  }
}
