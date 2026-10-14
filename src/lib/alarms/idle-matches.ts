import type { PrismaClient } from "@/generated/prisma/client";

/** A finished match with no bet is deleted once it started this long ago and nothing changed on it since. */
export const IDLE_MATCH_HOURS = 24;

/**
 * Keeps Completed tidy: matches whose alarm is over (done, cancelled or
 * failed) with no bet recorded go a day after they started, unless edited in
 * that time. Matches with a bet are never deleted: they're the profit history.
 */
export async function deleteIdleMatches(prisma: PrismaClient, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - IDLE_MATCH_HOURS * 3_600_000);
  const res = await prisma.match.deleteMany({
    where: {
      startsAt: { lt: cutoff },
      updatedAt: { lt: cutoff },
      bet: { is: null },
      OR: [{ alarm: { is: null } }, { alarm: { is: { status: { in: ["COMPLETED", "CANCELLED", "FAILED"] }, updatedAt: { lt: cutoff } } } }],
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
    if (n) console.log(`[matches] deleted ${n} finished match(es) with no bet`);
  } catch (err) {
    console.error("[matches] cleanup failed", err);
  }
}
