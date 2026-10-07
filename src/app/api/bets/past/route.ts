import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth/current";
import { handle, parseJson } from "@/lib/api";
import { pastBetSchema } from "@/lib/validation/match";
import { createPastBet } from "@/lib/bets/service";
import { getMatch } from "@/lib/alarms/queries";

/** Add a bet on a match that has already been played (Profit page). */
export const POST = handle(async (request: Request) => {
  const userId = await requireUserId();
  const input = await parseJson(request, pastBetSchema);
  const { matchId, combined } = await createPastBet(db(), userId, input);
  return NextResponse.json({ match: await getMatch(db(), userId, matchId), combined }, { status: 201 });
});
