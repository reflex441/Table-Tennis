import { z } from "zod";
import { NBA_MARKETS } from "@/lib/nba/parse";

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "Too long")
    .nullish()
    .transform((v) => (v ? v : null));

const isoDate = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date");

const fields = {
  tipster: z.string().trim().min(1, "Enter whose pick it is").max(40),
  pick: z.string().trim().min(1, "Enter the pick").max(200),
  market: z.enum(NBA_MARKETS),
  game: text(120),
  player: text(60),
  stat: text(20),
  line: z.number().min(-500).max(500).nullish().transform((v) => v ?? null),
  side: z.enum(["OVER", "UNDER"]).nullish().transform((v) => v ?? null),
  stake: z.number().positive("Units must be more than 0").max(1000, "At most 1000 units"),
  odds: z.number().gt(1, "Decimal odds must be above 1.00").max(1000).nullish().transform((v) => v ?? null),
  bookmaker: text(40),
  placedAt: isoDate,
  result: z.enum(["PENDING", "WON", "LOST", "VOID"]),
  notes: text(500),
};

/** An NBA bet (screenshot review or typed in). */
export const nbaBetSchema = z.object({ ...fields, market: fields.market.default("OTHER"), result: fields.result.default("PENDING") });

export type NbaBetInput = z.infer<typeof nbaBetSchema>;

/** Edit or settle: any of the fields (no defaults, so leaving one out keeps it). */
export const nbaBetUpdateSchema = z.object(fields).partial();
export type NbaBetUpdate = z.infer<typeof nbaBetUpdateSchema>;
