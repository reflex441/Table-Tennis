import type { PrismaClient } from "@/generated/prisma/client";

/**
 * When the external cron service (cron-job.org on Vercel) last called
 * /api/cron/dispatch, so Settings can warn when it has stopped.
 */
const KEY = "lastCronAt";

export async function recordCronRun(prisma: PrismaClient, now = new Date()): Promise<void> {
  await prisma.appSecret.upsert({ where: { name: KEY }, create: { name: KEY, value: now.toISOString() }, update: { value: now.toISOString() } });
}

export async function lastCronRun(prisma: PrismaClient): Promise<Date | null> {
  const row = await prisma.appSecret.findUnique({ where: { name: KEY } });
  const at = row ? new Date(row.value) : null;
  return at && !Number.isNaN(at.getTime()) ? at : null;
}

/** The cron service counts as working if it called within the last 3 minutes. */
export function cronHealthy(last: Date | null, now = new Date()): boolean {
  return last !== null && now.getTime() - last.getTime() <= 3 * 60_000;
}
