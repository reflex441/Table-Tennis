import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handle, jsonError, parseJson } from "@/lib/api";
import { betInputSchema } from "@/lib/validation/match";
import { deleteBet, updateBet } from "@/lib/bets/service";
import { getMatch } from "@/lib/alarms/queries";

type Ctx = { params: Promise<{ id: string }> };

/** Record / edit / settle the bet on a match (stake in units, decimal odds). */
export const PUT = handle(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const input = await parseJson(request, betInputSchema);
  await updateBet(db(), id, input);
  const match = await getMatch(db(), id);
  if (!match) return jsonError(404, "not_found", "Match not found.");
  return NextResponse.json({ match });
});

export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  await deleteBet(db(), id);
  const match = await getMatch(db(), id);
  if (!match) return jsonError(404, "not_found", "Match not found.");
  return NextResponse.json({ match });
});
