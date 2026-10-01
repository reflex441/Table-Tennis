import { NextResponse, connection } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth/current";
import { handle, jsonError } from "@/lib/api";
import { listBetRows } from "@/lib/bets/queries";
import { summarize, summarizeBy } from "@/lib/bets/profit";
import { formatZodError, playTypeSchema } from "@/lib/validation/match";

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(3650).optional(),
  type: playTypeSchema.optional(),
});

/** Profit summary (units): overall, bot vs personal, per competition, plus the bet rows. */
export const GET = handle(async (request: Request) => {
  await connection();
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) return jsonError(422, "validation_error", formatZodError(parsed.error));
  const { days, type } = parsed.data;
  const since = days ? new Date(Date.now() - days * 86_400_000) : undefined;
  const rows = await listBetRows(db(), await requireUserId(), { since, playType: type });
  return NextResponse.json({
    overall: summarize(rows),
    byPlayType: {
      BOT: summarize(rows.filter((r) => r.playType === "BOT")),
      PERSONAL: summarize(rows.filter((r) => r.playType === "PERSONAL")),
    },
    byCompetition: summarizeBy(rows, (r) => r.competition ?? "Unknown"),
    bets: rows,
  });
});
