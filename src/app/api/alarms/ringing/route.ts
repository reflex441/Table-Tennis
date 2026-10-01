import { NextResponse } from "next/server";
import { connection } from "next/server";
import { db } from "@/lib/db";
import { handle } from "@/lib/api";
import { listRingingAlarms } from "@/lib/alarms/service";

/** Alarms currently ringing (triggered, not confirmed, match not started). */
export const GET = handle(async () => {
  await connection();
  return NextResponse.json({ matches: await listRingingAlarms(db()) });
});
