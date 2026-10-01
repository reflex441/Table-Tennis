import type { PrismaClient } from "@/generated/prisma/client";
import type { SettingsDTO, SettingsUpdate } from "@/lib/validation/settings";

export async function getSettings(prisma: PrismaClient): Promise<SettingsDTO> {
  const s = await prisma.settings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  return {
    defaultReminderMinutes: s.defaultReminderMinutes,
    timezone: s.timezone,
    timezoneConfirmed: s.timezoneConfirmed,
    dateOrder: s.dateOrder === "MDY" ? "MDY" : "DMY",
    pushEnabled: s.pushEnabled,
    inAppEnabled: s.inAppEnabled,
    soundEnabled: s.soundEnabled,
    includeStatsInNotification: s.includeStatsInNotification,
  };
}

export async function updateSettings(prisma: PrismaClient, update: SettingsUpdate): Promise<SettingsDTO> {
  await prisma.settings.upsert({ where: { id: 1 }, create: { id: 1, ...update }, update });
  return getSettings(prisma);
}
