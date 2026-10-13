import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth/current";
import { handle, parseJson } from "@/lib/api";
import { nbaBetUpdateSchema } from "@/lib/validation/nba";
import { deleteNbaBet, updateNbaBet } from "@/lib/nba/service";

type Ctx = { params: Promise<{ id: string }> };

/** Edit or settle (Won / Lost / Void) an NBA bet. */
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const input = await parseJson(request, nbaBetUpdateSchema);
  return NextResponse.json({ bet: await updateNbaBet(db(), await requireUserId(), id, input) });
});

export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  await deleteNbaBet(db(), await requireUserId(), id);
  return new NextResponse(null, { status: 204 });
});
