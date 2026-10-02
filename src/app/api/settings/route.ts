import { NextResponse } from "next/server";
import { connection } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth/current";
import { handle, parseJson } from "@/lib/api";
import { getSettings, updateSettings } from "@/lib/settings";
import { settingsUpdateSchema } from "@/lib/validation/settings";
import { applyDefaultReminder } from "@/lib/alarms/service";
import { wakeScheduler } from "@/lib/scheduler/runner";

export const GET = handle(async () => {
  await connection();
  return NextResponse.json({ settings: await getSettings(db(), await requireUserId()) });
});

export const PUT = handle(async (request: Request) => {
  const userId = await requireUserId();
  const update = await parseJson(request, settingsUpdateSchema);
  const before = update.defaultReminderMinutes !== undefined ? await getSettings(db(), userId) : null;
  const settings = await updateSettings(db(), userId, update);
  // Upcoming alarms on the old default move to the new one.
  if (before && (await applyDefaultReminder(db(), userId, before.defaultReminderMinutes, settings.defaultReminderMinutes))) wakeScheduler();
  return NextResponse.json({ settings });
});
