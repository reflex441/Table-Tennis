import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handle, parseJson } from "@/lib/api";
import { acknowledgeAlarm, toMatchDTO } from "@/lib/alarms/service";
import { ackSchema } from "@/lib/validation/match";

/**
 * "I've placed the bet" / "Skip": stops the alarm ringing on every device.
 * "placed" also records the bet (stake in units, optional decimal odds).
 */
export const POST = handle(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { action, stake, odds } = await parseJson(request, ackSchema);
  const match = await acknowledgeAlarm(db(), id, action, new Date(), { stake, odds });
  return NextResponse.json({ match: toMatchDTO(match) });
});
