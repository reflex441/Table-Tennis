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

/**
 * Gemini API key as pasted by the user. Whitespace and invisible characters
 * (often picked up when copying) are removed; any printable ASCII character
 * is allowed because Google's key formats vary (some contain '.').
 * Shared by "Test" and "Save" so both always accept the same keys.
 */
export const geminiApiKeySchema = z
  .string()
  .transform((s) => s.replace(/[\s\u200B-\u200D\u2060\uFEFF]/g, ""))
  .pipe(
    z
      .string()
      .min(20, "That doesn't look like a Gemini API key (too short)")
      .max(200, "That doesn't look like a Gemini API key (too long)")
      .regex(/^[\x21-\x7E]+$/, "The key contains characters that can't be part of an API key"),
  );

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
    screenshotsAreToday: z.boolean(),
    screenshotTimesAreLocal: z.boolean(),
    scanSpeed: z.enum(["fastest", "fast", "careful"]),
    ringUntilAck: z.boolean(),
    repeatSeconds: z.number().int().min(15, "At least 15 seconds").max(300, "At most 5 minutes"),
    unitSize: z.number().positive("Must be more than 0").max(1_000_000),
    currency: z.string().trim().min(1).max(4),
    useAverageOdds: z.boolean(),
    averageOdds: z.number().gt(1, "Decimal odds must be above 1.00").max(1000),
    /** New Gemini API key, or null to remove the stored key. */
    geminiApiKey: geminiApiKeySchema.nullable(),
  })
  .partial();

export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;

export type ScanSpeed = "fastest" | "fast" | "careful";

/** How much Gemini "thinks" before answering, per scan speed. */
export const SCAN_SPEED_THINKING: Record<ScanSpeed, "MINIMAL" | "LOW" | "MEDIUM"> = {
  fastest: "MINIMAL",
  fast: "LOW",
  careful: "MEDIUM",
};

export interface SettingsDTO {
  defaultReminderMinutes: number;
  timezone: string;
  timezoneConfirmed: boolean;
  dateOrder: "DMY" | "MDY";
  pushEnabled: boolean;
  inAppEnabled: boolean;
  soundEnabled: boolean;
  includeStatsInNotification: boolean;
  screenshotsAreToday: boolean;
  screenshotTimesAreLocal: boolean;
  scanSpeed: ScanSpeed;
  /** Keep alerting until the user confirms the bet. */
  ringUntilAck: boolean;
  /** Seconds between repeated push notifications while ringing. */
  repeatSeconds: number;
  /** Money per betting unit. */
  unitSize: number;
  /** Currency symbol, e.g. "$". */
  currency: string;
  /** Use averageOdds for every bet's profit (the bets' own odds are kept). */
  useAverageOdds: boolean;
  /** Decimal odds used for all bets when useAverageOdds is on. */
  averageOdds: number;
  /** Where the Gemini key comes from. The key itself is never sent to the browser. */
  geminiKeySource: "settings" | "env" | "none";
  /** Masked hint such as "…x7Qk" for a key saved in Settings. */
  geminiKeyHint: string | null;
}
