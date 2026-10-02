import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth/current";
import { handle } from "@/lib/api";
import { applyDefaultReminder } from "@/lib/alarms/service";
import { getSettings } from "@/lib/settings";
import { wakeScheduler } from "@/lib/scheduler/runner";

/** Use the default alarm time (Settings) for every upcoming alarm. */
export const POST = handle(async () => {
  const userId = await requireUserId();
  const { defaultReminderMinutes } = await getSettings(db(), userId);
  const moved = await applyDefaultReminder(db(), userId, null, defaultReminderMinutes);
  if (moved) wakeScheduler();
  return NextResponse.json({ moved });
});
