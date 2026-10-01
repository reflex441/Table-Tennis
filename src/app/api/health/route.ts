import { NextResponse } from "next/server";
import { connection } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

export async function GET() {
  await connection();
  const e = env();
  let database = false;
  try {
    await db().$queryRaw`SELECT 1`;
    database = true;
  } catch {
    database = false;
  }
  return NextResponse.json(
    {
      ok: database,
      database,
      geminiConfigured: Boolean(e.GEMINI_API_KEY),
      pushConfigured: Boolean(e.VAPID_PUBLIC_KEY && e.VAPID_PRIVATE_KEY),
      schedulerMode: e.SCHEDULER_MODE,
      cronConfigured: Boolean(e.CRON_SECRET),
    },
    { status: database ? 200 : 503 },
  );
}
