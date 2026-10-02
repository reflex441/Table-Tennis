/**
 * Starts the in-process alarm scheduler when the Next.js server boots
 * (SCHEDULER_MODE=inprocess, the default). Use SCHEDULER_MODE=worker when a
 * separate `npm run worker` process runs the loop, or SCHEDULER_MODE=external
 * on serverless platforms where a cron service calls /api/cron/dispatch.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // On Vercel (serverless) a cron service calls /api/cron/dispatch instead.
  const mode = process.env.SCHEDULER_MODE || (process.env.VERCEL ? "external" : "inprocess");
  if (mode !== "inprocess") return;
  if (!process.env.DATABASE_URL) {
    console.warn("[scheduler] DATABASE_URL not set - scheduler not started.");
    return;
  }
  // Skip during `next build`.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { startScheduler } = await import("@/lib/scheduler/runner");
  startScheduler({ intervalMs: Number(process.env.SCHEDULER_INTERVAL_MS) || 10_000 });
}
