/**
 * Standalone scheduler worker: `npm run worker`.
 * Run it next to `next start` with SCHEDULER_MODE=worker for the web server,
 * or on its own machine. Several workers can run safely at the same time.
 */
import "dotenv/config";
import { startScheduler, stopScheduler } from "@/lib/scheduler/runner";

const interval = Number(process.env.SCHEDULER_INTERVAL_MS) || 10_000;
console.log("[worker] starting alarm scheduler");
startScheduler({ intervalMs: interval, log: (m) => console.log(`[worker] ${new Date().toISOString()} ${m}`) });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`[worker] ${signal} received, stopping`);
    stopScheduler();
    setTimeout(() => process.exit(0), 200);
  });
}
