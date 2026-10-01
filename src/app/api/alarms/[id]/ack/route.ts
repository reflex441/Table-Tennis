import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handle, parseJson } from "@/lib/api";
import { acknowledgeAlarm, toMatchDTO } from "@/lib/alarms/service";

const schema = z.object({ action: z.enum(["placed", "skipped"]).default("placed") });

/** "I've placed the bet" / "Skip": stops the alarm ringing on every device. */
export const POST = handle(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { action } = await parseJson(request, schema);
  const match = await acknowledgeAlarm(db(), id, action);
  return NextResponse.json({ match: toMatchDTO(match) });
});
