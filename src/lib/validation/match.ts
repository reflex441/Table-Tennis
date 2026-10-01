import { z } from "zod";

export const REMINDER_PRESETS = [1, 3, 5, 10, 15, 30] as const;
export const MIN_REMINDER_MINUTES = 0;
export const MAX_REMINDER_MINUTES = 24 * 60;

export const reminderMinutesSchema = z
  .number({ error: "Reminder must be a number of minutes" })
  .int("Reminder must be a whole number of minutes")
  .min(MIN_REMINDER_MINUTES, "Reminder cannot be negative")
  .max(MAX_REMINDER_MINUTES, "Reminder can be at most 24 hours");

const nameSchema = z.string().trim().min(1, "Required").max(60, "Too long");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "Too long")
    .nullish()
    .transform((v) => (v ? v : null));

export const statisticsSchema = z.object({
  selection: z.enum(["OVER", "UNDER"]).nullish().transform((v) => v ?? null),
  pointsLine: z.number().min(0).max(500).nullish().transform((v) => v ?? null),
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
export const betInputSchema = z.object({
  stake: z.number().positive("Stake must be more than 0").max(1000, "At most 1000 units").optional(),
  odds: z.number().gt(1, "Decimal odds must be above 1.00").max(1000).nullish(),
  result: z.enum(["PENDING", "WON", "LOST", "VOID"]).optional(),
});

export type BetInput = z.infer<typeof betInputSchema>;

export const matchInputSchema = z
  .object({
    player1: nameSchema,
    player2: nameSchema,
    competition: optionalText(120),
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
    competition: optionalText(120).optional(),
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
});

export const alarmActionSchema = z.object({
  action: z.enum(["cancel", "reactivate", "complete"]),
});

export function formatZodError(error: z.ZodError): string {
  return error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ");
}
