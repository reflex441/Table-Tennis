import { NextResponse } from "next/server";
import { connection } from "next/server";
import { db } from "@/lib/db";
import { handle, parseJson } from "@/lib/api";
import { getSettings, updateSettings } from "@/lib/settings";
import { settingsUpdateSchema } from "@/lib/validation/settings";

export const GET = handle(async () => {
  await connection();
  return NextResponse.json({ settings: await getSettings(db()) });
});

export const PUT = handle(async (request: Request) => {
  const update = await parseJson(request, settingsUpdateSchema);
  return NextResponse.json({ settings: await updateSettings(db(), update) });
});
