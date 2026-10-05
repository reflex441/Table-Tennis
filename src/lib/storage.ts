import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Database space: screenshots are by far the biggest thing stored, so each
 * one is deleted a day after its match (after the last one, if it shows
 * several). Uploads that never became a match go a day after uploading.
 * Matches, bets and stats are kept forever (the Profit page doesn't need
 * the images).
 */
export const SCREENSHOT_KEEP_HOURS = 24;

/** Deletes screenshots no longer needed (their matches stay). Returns how many. */
export async function deleteOldScreenshots(prisma: PrismaClient, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - SCREENSHOT_KEEP_HOURS * 3_600_000);
  const res = await prisma.screenshot.deleteMany({
    where: {
      OR: [
        // Every match on it started more than a day ago.
        { sources: { some: {}, every: { match: { startsAt: { lt: cutoff } } } } },
        // Never turned into a match.
        { sources: { none: {} }, createdAt: { lt: cutoff } },
      ],
    },
  });
  return res.count;
}

const cleanup = globalThis as unknown as { __ttLastScreenshotCleanup?: number };

/** At most once an hour per server instance (called from the alarm checker). */
export async function deleteOldScreenshotsIfDue(prisma: PrismaClient, now = new Date()): Promise<void> {
  if (now.getTime() - (cleanup.__ttLastScreenshotCleanup ?? 0) < 60 * 60_000) return;
  cleanup.__ttLastScreenshotCleanup = now.getTime();
  try {
    const n = await deleteOldScreenshots(prisma, now);
    if (n) console.log(`[storage] deleted ${n} screenshot(s) of matches played over a day ago`);
  } catch (err) {
    console.error("[storage] screenshot cleanup failed", err);
  }
}

export interface StorageUsage {
  /** Whole database, as Postgres reports it. */
  usedBytes: number;
  /** The plan's limit (STORAGE_LIMIT_MB, default 500 MB - Supabase's free plan). */
  limitBytes: number;
  screenshots: number;
  screenshotBytes: number;
}

export async function storageUsage(prisma: PrismaClient): Promise<StorageUsage> {
  const [db] = await prisma.$queryRaw<{ size: bigint }[]>`SELECT pg_database_size(current_database()) AS size`;
  const [shots] = await prisma.$queryRaw<{ n: number; bytes: bigint | null }[]>`SELECT COUNT(*)::int AS n, SUM("sizeBytes")::bigint AS bytes FROM "Screenshot"`;
  const limitMb = Number(process.env.STORAGE_LIMIT_MB) > 0 ? Number(process.env.STORAGE_LIMIT_MB) : 500;
  return {
    usedBytes: Number(db?.size ?? 0),
    limitBytes: limitMb * 1024 * 1024,
    screenshots: shots?.n ?? 0,
    screenshotBytes: Number(shots?.bytes ?? 0),
  };
}
