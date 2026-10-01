import { NextResponse } from "next/server";
import { connection } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth/current";
import { handle, parseJson } from "@/lib/api";
import { getSettings, updateSettings } from "@/lib/settings";
import { settingsUpdateSchema } from "@/lib/validation/settings";

export const GET = handle(async () => {
  await connection();
  return NextResponse.json({ settings: await getSettings(db(), await requireUserId()) });
});

export const PUT = handle(async (request: Request) => {
  const userId = await requireUserId();
  const update = await parseJson(request, settingsUpdateSchema);
  return NextResponse.json({ settings: await updateSettings(db(), userId, update) });
});
