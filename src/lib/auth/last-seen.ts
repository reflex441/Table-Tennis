import type { PrismaClient } from "@/generated/prisma/client";

/** How often an account's last visit is saved (so it costs next to nothing). */
const EVERY_MS = 10 * 60_000;

const g = globalThis as unknown as { __ttSeen?: Map<string, number> };

/**
 * Note that an account is using the site (for the owner's Settings →
 * Accounts list): saved at most every 10 minutes per account. Returns
 * whether it was saved.
 */
export async function recordVisit(prisma: PrismaClient, userId: string, now = new Date()): Promise<boolean> {
  const seen = (g.__ttSeen ??= new Map());
  if (now.getTime() - (seen.get(userId) ?? 0) < EVERY_MS) return false;
  seen.set(userId, now.getTime());
  const res = await prisma.user.updateMany({
    where: { id: userId, OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date(now.getTime() - EVERY_MS) } }] },
    data: { lastSeenAt: now },
  });
  return res.count > 0;
}
