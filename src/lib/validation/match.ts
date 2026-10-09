import { z } from "zod";
import { SELECTIONS } from "@/lib/selection";
import { shortPlayerName } from "@/lib/matching/player-names";
import { tidyCompetition } from "@/lib/leagues";

export const REMINDER_PRESETS = [1, 3, 5, 10, 15, 30] as const;
export const MIN_REMINDER_MINUTES = 0;
export const MAX_REMINDER_MINUTES = 24 * 60;

export const reminderMinutesSchema = z
  .number({ error: "Reminder must be a number of minutes" })
  .int("Reminder must be a whole number of minutes")
  .min(MIN_REMINDER_MINUTES, "Reminder cannot be negative")
  .max(MAX_REMINDER_MINUTES, "Reminder can be at most 24 hours");

/** Stored as "Surname F." ("Mariusz Koczyba" -> "Koczyba M."). */
const nameSchema = z.string().trim().min(1, "Required").max(60, "Too long").transform(shortPlayerName);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "Too long")
    .nullish()
    .transform((v) => (v ? v : null));
/** "TT Cup" / "tt elite series" -> "TT CUP" / "TT ELITE", so a league is always spelt one way. */
const competitionSchema = optionalText(120).transform(tidyCompetition);

export const statisticsSchema = z.object({
  selection: z.enum(SELECTIONS).nullish().transform((v) => v ?? null),
  pointsLine: z.number().min(-500).max(500).nullish().transform((v) => v ?? null),
  ouStats: z
    .string()
    .trim()
    .regex(/^\d{1,4}\/\d{1,4}$/, 'O/U statistics must look like "20/9"')
    .nullish()
    .or(z.literal("").transform(() => null))
    .transform((v) => v ?? null),
  ouHitRate: z.number().min(0, "0-100").max(100, "0-100").nullish().transform((v) => v ?? null),
  edge: z.number().min(-100, "-100..100").max(100, "-100..100").nullish().transform((v) => v ?? null),
});

const isoDate = z.iso.datetime({ offset: true, error: "Start time must be an ISO date-time" });

export const playTypeSchema = z.enum(["BOT", "PERSONAL"]);

/** Record / edit a placed bet. Stake in units; decimal odds. */
const betResultSchema = z.enum(["PENDING", "WON", "LOST", "VOID"]);

/** One pick of a split bet. */
export const betLegSchema = z.object({
  selection: z.enum(SELECTIONS),
  stake: z.number().positive("Stake must be more than 0").max(1000, "At most 1000 units"),
  odds: z.number().gt(1, "Decimal odds must be above 1.00").max(1000).nullish(),
  result: betResultSchema.optional(),
  /** Bot or personal for this pick only (null: the match's). Kept as it was when left out. */
  playType: z.enum(["BOT", "PERSONAL"]).nullish(),
});

/** 2-3 picks on one play, e.g. 0.5u UNDER + 0.5u SWEEP; null turns a split bet back into one bet. */
export const betLegsSchema = z.array(betLegSchema).min(2, "A split bet needs at least 2 picks").max(3, "At most 3 picks");

export const betInputSchema = z.object({
  stake: z.number().positive("Stake must be more than 0").max(1000, "At most 1000 units").optional(),
  odds: z.number().gt(1, "Decimal odds must be above 1.00").max(1000).nullish(),
  /** Settles the whole bet (every pick of a split bet). */
  result: betResultSchema.optional(),
  legs: betLegsSchema.nullish(),
  /** Settles one pick of a split bet, or makes it a bot / personal play (null: the match's). */
  leg: z
    .object({ index: z.number().int().min(0).max(2), result: betResultSchema.optional(), playType: z.enum(["BOT", "PERSONAL"]).nullish() })
    .refine((l) => l.result !== undefined || l.playType !== undefined, "Nothing to change on that pick")
    .optional(),
});

export type BetLegInput = z.infer<typeof betLegSchema>;

export type BetInput = z.infer<typeof betInputSchema>;

export const matchInputSchema = z
  .object({
    player1: nameSchema,
    player2: nameSchema,
    competition: competitionSchema,
    startsAt: isoDate,
    timezone: z.string().trim().min(1).max(64),
    rawTimeText: optionalText(200),
    notes: optionalText(500),
    reminderMinutes: reminderMinutesSchema,
    screenshotIds: z.array(z.string().min(1).max(40)).max(20).default([]),
    /** Create even if a similar match already exists. */
    allowSimilar: z.boolean().default(false),
    /** BOT if the screenshot showed a pick badge; defaults from the selection. */
    playType: playTypeSchema.optional(),
    /** Planned stake in units (default 1u). */
    stakeUnits: z.number().min(0).max(1000).nullish().transform((v) => v ?? null),
    /** Planned decimal odds (the average odds from Settings when ticked). */
    odds: z.number().gt(1, "Decimal odds must be above 1.00").max(1000).nullish().transform((v) => v ?? null),
  })
  .and(statisticsSchema);

export type MatchInput = z.infer<typeof matchInputSchema>;

export const createMatchesSchema = z.object({
  matches: z.array(matchInputSchema).min(1, "Nothing to create").max(50),
});

export const updateMatchSchema = z
  .object({
    player1: nameSchema.optional(),
    player2: nameSchema.optional(),
    competition: competitionSchema.optional(),
    startsAt: isoDate.optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
    notes: optionalText(500).optional(),
    reminderMinutes: reminderMinutesSchema.optional(),
    playType: playTypeSchema.optional(),
  })
  .and(statisticsSchema.partial());

export type UpdateMatchInput = z.infer<typeof updateMatchSchema>;

export const ackSchema = z.object({
  action: z.enum(["placed", "skipped"]).default("placed"),
  stake: z.number().positive().max(1000).optional(),
  odds: z.number().gt(1).max(1000).nullish(),
  legs: betLegsSchema.optional(),
});

export const alarmActionSchema = z.object({
  /** "placed": bet already placed - record it, skip the notification, mark completed. */
  action: z.enum(["cancel", "reactivate", "complete", "placed"]),
  /** With "placed": the units and odds you got. */
  stake: z.number().positive().max(1000).optional(),
  odds: z.number().gt(1, "Decimal odds must be above 1.00").max(1000).optional(),
});

export function formatZodError(error: z.ZodError): string {
  return error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ");
}

/** A bet on a match that has already been played (Profit page -> Add past bet). */
export const pastBetSchema = z.object({
  player1: nameSchema,
  player2: nameSchema,
  competition: competitionSchema,
  startsAt: isoDate,
  timezone: z.string().trim().min(1).max(64),
  playType: playTypeSchema,
  selection: z.enum(SELECTIONS).nullish().transform((v) => v ?? null),
  pointsLine: z.number().min(-500).max(500).nullish().transform((v) => v ?? null),
  stake: z.number().positive("Units must be more than 0").max(1000, "At most 1000 units"),
  odds: z.number().gt(1, "Decimal odds must be above 1.00").max(1000).nullish().transform((v) => v ?? null),
  result: z.enum(["PENDING", "WON", "LOST", "VOID"]),
});

export type PastBetInput = z.infer<typeof pastBetSchema>;
