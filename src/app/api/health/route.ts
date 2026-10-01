import { NextResponse } from "next/server";
import { connection } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getGeminiApiKey } from "@/lib/settings";

export async function GET() {
  await connection();
  const e = env();
  let database = false;
  let geminiConfigured = Boolean(e.GEMINI_API_KEY);
  try {
    await db().$queryRaw`SELECT 1`;
    database = true;
    geminiConfigured = Boolean(await getGeminiApiKey(db()));
  } catch {
    database = false;
  }
  return NextResponse.json(
    {
      ok: database,
      database,
      geminiConfigured,
      pushConfigured: Boolean(e.VAPID_PUBLIC_KEY && e.VAPID_PRIVATE_KEY),
      schedulerMode: e.SCHEDULER_MODE,
      cronConfigured: Boolean(e.CRON_SECRET),
    },
    { status: database ? 200 : 503 },
  );
}
