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
    /** New Gemini API key, or null to remove the stored key. */
    geminiApiKey: z
      .string()
      .trim()
      .min(20, "That doesn't look like a Gemini API key")
      .max(200, "That doesn't look like a Gemini API key")
      .regex(/^[A-Za-z0-9_-]+$/, "API keys contain only letters, digits, '-' and '_'")
      .nullable(),
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
  /** Where the Gemini key comes from. The key itself is never sent to the browser. */
  geminiKeySource: "settings" | "env" | "none";
  /** Masked hint such as "…x7Qk" for a key saved in Settings. */
  geminiKeyHint: string | null;
}
