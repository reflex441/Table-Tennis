import { z } from "zod";
import { isSafeUrl, type LeagueLink } from "@/lib/leagues";
import { ALARM_SOUNDS, type AlarmSound } from "@/lib/alarm-sounds";
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

/** A Gemini model ID such as "gemini-3.5-flash-lite" ("models/" prefix allowed). */
const modelId = z
  .string()
  .trim()
  .transform((v) => v.replace(/^models\//, ""))
  .pipe(z.string().min(1, "Enter a model name").max(80).regex(/^[a-z0-9][a-z0-9._-]*$/i, 'Use a model name like "gemini-3.5-flash-lite"'));

export const geminiModelSchema = modelId;
/** Comma-separated backup models, or "" to turn the backup off. */
export const geminiFallbackSchema = z
  .string()
  .trim()
  .max(200)
  .transform((v) => v.split(",").map((m) => m.trim().replace(/^models\//, "")).filter(Boolean))
  .pipe(z.array(z.string().max(80).regex(/^[a-z0-9][a-z0-9._-]*$/i, 'Use model names like "gemini-3.8-flash", separated by commas')).max(4))
  .transform((list) => list.join(","));

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
    ringUntilAck: z.boolean(),
    repeatSeconds: z.number().int().min(15, "At least 15 seconds").max(300, "At most 5 minutes"),
    alarmVolume: z.number().int().min(1, "At least 1%").max(100, "At most 100%"),
    alarmSound: z.enum(ALARM_SOUNDS),
    unitSize: z.number().positive("Must be more than 0").max(1_000_000),
    currency: z.string().trim().min(1).max(4),
    useAverageOdds: z.boolean(),
    averageOdds: z.number().gt(1, "Decimal odds must be above 1.00").max(1000),
    geminiModel: geminiModelSchema,
    geminiFallbackModel: geminiFallbackSchema,
    showOnLeaderboard: z.boolean(),
    tailPlayType: z.enum(["BOT", "PERSONAL"]).nullable(),
    leagueLinks: z
      .array(
        z.object({
          league: z.string().trim().min(1, "Enter the league name").max(60),
          url: z
            .string()
            .trim()
            .max(500)
            .refine((u) => isSafeUrl(u), "Enter a full web address starting with https://"),
        }),
      )
      .max(30),
    /** New Gemini API key, or null to remove the stored key. */
    geminiApiKey: geminiApiKeySchema.nullable(),
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
  screenshotsAreToday: boolean;
  screenshotTimesAreLocal: boolean;
  /** Keep alerting until the user confirms the bet. */
  ringUntilAck: boolean;
  /** Seconds between repeated push notifications while ringing. */
  repeatSeconds: number;
  /** Alarm and chime loudness, 1-100. */
  alarmVolume: number;
  /** Which alarm sound plays. */
  alarmSound: AlarmSound;
  /** Money per betting unit. */
  unitSize: number;
  /** Currency symbol, e.g. "$". */
  currency: string;
  /** Use averageOdds for every bet's profit (the bets' own odds are kept). */
  useAverageOdds: boolean;
  /** Decimal odds used for all bets when useAverageOdds is on. */
  averageOdds: number;
  /** Gemini model used for scanning. */
  geminiModel: string;
  /** Comma-separated backup models ("" = off). */
  geminiFallbackModel: string;
  /** Appear on the leaderboard (display name only). */
  showOnLeaderboard: boolean;
  /** Tailing page: only show / copy bot or personal plays (null = all). */
  tailPlayType: "BOT" | "PERSONAL" | null;
  /** Bookmaker link per league, opened from the player names. */
  leagueLinks: LeagueLink[];
  /** Whether this account has saved a Gemini key. The key itself is never sent to the browser. */
  geminiKeySource: "settings" | "none";
  /** Masked hint such as "…x7Qk" for a key saved in Settings. */
  geminiKeyHint: string | null;
}
