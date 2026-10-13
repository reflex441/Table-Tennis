import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth/current";
import { handle, parseJson } from "@/lib/api";
import { nbaBetSchema } from "@/lib/validation/nba";
import { createNbaBet, listNbaBets } from "@/lib/nba/service";

export const GET = handle(async () => {
  return NextResponse.json({ bets: await listNbaBets(db(), await requireUserId()) });
});

/** Add an NBA bet (from a scanned screenshot or typed in). */
export const POST = handle(async (request: Request) => {
  const userId = await requireUserId();
  const input = await parseJson(request, nbaBetSchema);
  return NextResponse.json({ bet: await createNbaBet(db(), userId, input) }, { status: 201 });
});
