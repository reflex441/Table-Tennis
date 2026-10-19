import { NextResponse } from "next/server";
import { connection } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth/current";
import { handle } from "@/lib/api";
import { listRingingAlarms } from "@/lib/alarms/service";
import { currentSavingLevel } from "@/lib/usage/meter";
import { POLL_SECONDS } from "@/lib/usage/budget";

/** Alarms currently ringing (triggered, not confirmed, match not started). */
export const GET = handle(async () => {
  await connection();
  const matches = await listRingingAlarms(db(), await requireUserId());
  // How often the computer alarm checks, slower as the month's server time fills up.
  return NextResponse.json({ matches, pollSeconds: POLL_SECONDS[await currentSavingLevel(db())].ringer });
});
