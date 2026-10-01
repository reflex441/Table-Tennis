import type { PrismaClient } from "@/generated/prisma/client";
import type { SettingsDTO, SettingsUpdate } from "@/lib/validation/settings";
import { recomputeProfits } from "@/lib/bets/service";

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

/** Models to scan with, from Settings → Gemini API (Model / Backup model). */
export async function getGeminiModels(prisma: PrismaClient): Promise<{ model: string; fallback: string[] }> {
  const s = await ensureRow(prisma);
  const model = s.geminiModel.trim() || "gemini-3.5-flash-lite";
  const fallback = s.geminiFallbackModel.split(",").map((m) => m.trim()).filter(Boolean);
  return { model, fallback };
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
    ringUntilAck: s.ringUntilAck,
    repeatSeconds: s.repeatSeconds,
    unitSize: s.unitSize,
    currency: s.currency,
    useAverageOdds: s.useAverageOdds,
    averageOdds: s.averageOdds,
    geminiModel: s.geminiModel,
    geminiFallbackModel: s.geminiFallbackModel,
    // Never include the key itself in this DTO: it is sent to the browser.
    geminiKeySource: s.geminiApiKey ? "settings" : envKey ? "env" : "none",
    geminiKeyHint: maskKey(s.geminiApiKey),
  };
}

export async function updateSettings(prisma: PrismaClient, update: SettingsUpdate): Promise<SettingsDTO> {
  const before = await ensureRow(prisma);
  const after = await prisma.settings.update({ where: { id: 1 }, data: update });
  // Switching average odds on/off (or changing them) re-prices every bet.
  if (before.useAverageOdds !== after.useAverageOdds || (after.useAverageOdds && before.averageOdds !== after.averageOdds)) {
    await recomputeProfits(prisma);
  }
  return getSettings(prisma);
}
