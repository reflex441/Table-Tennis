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

export async function getSettings(prisma: PrismaClient): Promise<SettingsDTO> {
  const s = await ensureRow(prisma);
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
  await ensureRow(prisma);
  await prisma.settings.update({ where: { id: 1 }, data: update });
  return getSettings(prisma);
}
