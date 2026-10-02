import { NextResponse } from "next/server";
import { connection } from "next/server";
import { db } from "@/lib/db";
import { env, vapidKeyProblem } from "@/lib/env";
import { getGeminiApiKey } from "@/lib/settings";
import { getCurrentUser } from "@/lib/auth/current";
import { googleConfigured } from "@/lib/auth/google";
import { cronHealthy, lastCronRun } from "@/lib/scheduler/heartbeat";

/** Liveness for load balancers; signed-in users also get configuration details. */
export async function GET() {
  await connection();
  const e = env();
  let database = false;
  let details: Record<string, unknown> = {};
  try {
    await db().$queryRaw`SELECT 1`;
    database = true;
    const user = await getCurrentUser();
    if (user) {
      details = {
        geminiConfigured: Boolean(await getGeminiApiKey(db(), user.id)),
        pushConfigured: !vapidKeyProblem(e.VAPID_PUBLIC_KEY, e.VAPID_PRIVATE_KEY),
        pushProblem: vapidKeyProblem(e.VAPID_PUBLIC_KEY, e.VAPID_PRIVATE_KEY),
        schedulerMode: e.SCHEDULER_MODE,
        cronConfigured: Boolean(e.CRON_SECRET),
        ...(e.SCHEDULER_MODE === "external"
          ? await lastCronRun(db()).then((last) => ({ cronLastRunAt: last?.toISOString() ?? null, cronHealthy: cronHealthy(last) }))
          : {}),
        googleSignIn: googleConfigured(),
      };
    }
  } catch {
    database = false;
  }
  return NextResponse.json({ ok: database, database, ...details }, { status: database ? 200 : 503 });
}
