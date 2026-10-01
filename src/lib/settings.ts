import type { PrismaClient } from "@/generated/prisma/client";
import type { SettingsDTO, SettingsUpdate } from "@/lib/validation/settings";

/**
 * Make sure the single settings row exists. `skipDuplicates` compiles to
 * INSERT ... ON CONFLICT DO NOTHING, which (unlike Prisma's upsert) is safe
 * when several requests/dispatchers race on first start.
 */
async function ensureRow(prisma: PrismaClient) {
  const existing = await prisma.settings.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  await prisma.settings.createMany({ data: [{ id: 1 }], skipDuplicates: true });
  return prisma.settings.findUniqueOrThrow({ where: { id: 1 } });
}

/** Show only the last 4 characters of a secret. */
export function maskKey(key: string | null | undefined): string | null {
  if (!key) return null;
  return `…${key.slice(-4)}`;
}

/**
 * The Gemini API key to use: one saved in Settings wins, otherwise the
 * GEMINI_API_KEY environment variable. Server-side only.
 */
export async function getGeminiApiKey(prisma: PrismaClient): Promise<string> {
  const s = await ensureRow(prisma);
  return s.geminiApiKey || process.env.GEMINI_API_KEY || "";
}

export async function getSettings(prisma: PrismaClient): Promise<SettingsDTO> {
  const s = await ensureRow(prisma);
  const envKey = process.env.GEMINI_API_KEY;
  return {
    defaultReminderMinutes: s.defaultReminderMinutes,
    timezone: s.timezone,
    timezoneConfirmed: s.timezoneConfirmed,
    dateOrder: s.dateOrder === "MDY" ? "MDY" : "DMY",
    pushEnabled: s.pushEnabled,
    inAppEnabled: s.inAppEnabled,
    soundEnabled: s.soundEnabled,
    includeStatsInNotification: s.includeStatsInNotification,
    screenshotsAreToday: s.screenshotsAreToday,
    screenshotTimesAreLocal: s.screenshotTimesAreLocal,
    scanSpeed: s.scanSpeed === "fastest" || s.scanSpeed === "careful" ? s.scanSpeed : "fast",
    ringUntilAck: s.ringUntilAck,
    repeatSeconds: s.repeatSeconds,
    // Never include the key itself in this DTO: it is sent to the browser.
    geminiKeySource: s.geminiApiKey ? "settings" : envKey ? "env" : "none",
    geminiKeyHint: maskKey(s.geminiApiKey),
  };
}

export async function updateSettings(prisma: PrismaClient, update: SettingsUpdate): Promise<SettingsDTO> {
  await ensureRow(prisma);
  await prisma.settings.update({ where: { id: 1 }, data: update });
  return getSettings(prisma);
}
