import { z } from "zod";
import { reminderMinutesSchema } from "./match";

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const settingsUpdateSchema = z
  .object({
    defaultReminderMinutes: reminderMinutesSchema,
    timezone: z.string().trim().min(1).max(64).refine(isValidTimeZone, "Unknown timezone"),
    timezoneConfirmed: z.boolean(),
    dateOrder: z.enum(["DMY", "MDY"]),
    pushEnabled: z.boolean(),
    inAppEnabled: z.boolean(),
    soundEnabled: z.boolean(),
    includeStatsInNotification: z.boolean(),
  })
  .partial();

export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;

export interface SettingsDTO {
  defaultReminderMinutes: number;
  timezone: string;
  timezoneConfirmed: boolean;
  dateOrder: "DMY" | "MDY";
  pushEnabled: boolean;
  inAppEnabled: boolean;
  soundEnabled: boolean;
  includeStatsInNotification: boolean;
}
