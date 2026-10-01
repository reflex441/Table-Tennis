import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handle, parseJson } from "@/lib/api";
import { alarmActionSchema } from "@/lib/validation/match";
import { changeAlarmState, toMatchDTO } from "@/lib/alarms/service";
import { wakeScheduler } from "@/lib/scheduler/runner";

/** Cancel, reactivate or complete a match's alarm. */
export const POST = handle(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { action } = await parseJson(request, alarmActionSchema);
  const match = await changeAlarmState(db(), id, action);
  if (action === "reactivate") wakeScheduler();
  return NextResponse.json({ match: toMatchDTO(match) });
});
