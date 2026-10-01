import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handle, jsonError, parseJson } from "@/lib/api";
import { updateMatchSchema } from "@/lib/validation/match";
import { deleteMatch, toMatchDTO, updateMatch } from "@/lib/alarms/service";
import { getMatch } from "@/lib/alarms/queries";
import { wakeScheduler } from "@/lib/scheduler/runner";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const match = await getMatch(db(), id);
  if (!match) return jsonError(404, "not_found", "Match not found.");
  return NextResponse.json({ match });
});

export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const input = await parseJson(request, updateMatchSchema);
  const match = await updateMatch(db(), id, input);
  wakeScheduler();
  return NextResponse.json({ match: toMatchDTO(match) });
});

export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  await deleteMatch(db(), id);
  return new NextResponse(null, { status: 204 });
});
