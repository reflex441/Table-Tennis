import type { PrismaClient } from "@/generated/prisma/client";
import type { SettingsDTO, SettingsUpdate } from "@/lib/validation/settings";

/**
 * Make sure the user's settings row exists. `skipDuplicates` compiles to
 * INSERT ... ON CONFLICT DO NOTHING, which (unlike Prisma's upsert) is safe
 * when several requests race on first use.
 */
async function ensureRow(prisma: PrismaClient, userId: string) {
  const existing = await prisma.settings.findUnique({ where: { userId } });
  if (existing) return existing;
  await prisma.settings.createMany({ data: [{ userId }], skipDuplicates: true });
  return prisma.settings.findUniqueOrThrow({ where: { userId } });
}

/** Show only the last 4 characters of a secret. */
export function maskKey(key: string | null | undefined): string | null {
  if (!key) return null;
  return `…${key.slice(-4)}`;
}

/** The user's own Gemini API key (each account adds its own). Server-side only. */
export async function getGeminiApiKey(prisma: PrismaClient, userId: string): Promise<string> {
  const s = await ensureRow(prisma, userId);
  return s.geminiApiKey || "";
}

/** Models to scan with, from Settings → Gemini API (Model / Backup model). */
export async function getGeminiModels(prisma: PrismaClient, userId: string): Promise<{ model: string; fallback: string[] }> {
  const s = await ensureRow(prisma, userId);
  const model = s.geminiModel.trim() || "gemini-3.5-flash-lite";
  const fallback = s.geminiFallbackModel.split(",").map((m) => m.trim()).filter(Boolean);
  return { model, fallback };
}

export async function getSettings(prisma: PrismaClient, userId: string): Promise<SettingsDTO> {
  const s = await ensureRow(prisma, userId);
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
    ringUntilAck: s.ringUntilAck,
    repeatSeconds: s.repeatSeconds,
    unitSize: s.unitSize,
    currency: s.currency,
    useAverageOdds: s.useAverageOdds,
    averageOdds: s.averageOdds,
    geminiModel: s.geminiModel,
    geminiFallbackModel: s.geminiFallbackModel,
    showOnLeaderboard: s.showOnLeaderboard,
    // Never include the key itself in this DTO: it is sent to the browser.
    geminiKeySource: s.geminiApiKey ? "settings" : "none",
    geminiKeyHint: maskKey(s.geminiApiKey),
  };
}

export async function updateSettings(prisma: PrismaClient, userId: string, update: SettingsUpdate): Promise<SettingsDTO> {
  await ensureRow(prisma, userId);
  await prisma.settings.update({ where: { userId }, data: update });
  return getSettings(prisma, userId);
}
