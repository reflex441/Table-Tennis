import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { handle, jsonError } from "@/lib/api";
import { runDispatchOnce } from "@/lib/scheduler/runner";
import { recordCronRun } from "@/lib/scheduler/heartbeat";
import { db } from "@/lib/db";

export const maxDuration = 60;

function authorised(request: Request): boolean {
  const secret = env().CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const url = new URL(request.url);
  const provided = header.startsWith("Bearer ") ? header.slice(7) : url.searchParams.get("secret") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * External scheduler entry point (Vercel Cron, cron-job.org, GitHub Actions,
 * Upstash QStash...). Call it every minute with `Authorization: Bearer $CRON_SECRET`.
 */
async function run(request: Request) {
  if (!env().CRON_SECRET) return jsonError(503, "cron_not_configured", "CRON_SECRET is not configured.");
  if (!authorised(request)) return jsonError(401, "unauthorized", "Invalid cron secret.");
  const report = await runDispatchOnce((m) => console.log(`[cron] ${m}`));
  await recordCronRun(db());
  return NextResponse.json({ ok: true, report });
}

export const GET = handle(run);
export const POST = handle(run);
