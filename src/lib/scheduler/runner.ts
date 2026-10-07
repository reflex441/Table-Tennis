import { dispatchDueAlarms, type DispatchReport } from "@/lib/alarms/dispatcher";
import { createPrismaStore } from "@/lib/alarms/prisma-store";
import { createWebPushSender } from "@/lib/push/web-push";
import { db } from "@/lib/db";
import { deleteOldScreenshotsIfDue } from "@/lib/storage";
import { shortenStoredPlayerNamesIfDue } from "@/lib/matching/tidy-names";

/**
 * Run one dispatch pass against the database. Used by the in-process loop,
 * the standalone worker and the /api/cron/dispatch endpoint.
 */
export async function runDispatchOnce(log?: (msg: string) => void): Promise<DispatchReport> {
  const report = await dispatchDueAlarms({ store: createPrismaStore(db()), push: createWebPushSender(), log });
  // Housekeeping on the same schedule (hourly): old screenshots, full player names.
  await deleteOldScreenshotsIfDue(db());
  await shortenStoredPlayerNamesIfDue(db());
  return report;
}

const fallback = globalThis as unknown as { __ttLastFallbackDispatch?: number };

/**
 * Backup for serverless hosting (SCHEDULER_MODE=external): while anyone has
 * the app open, its regular polling also delivers due alarms, so they still
 * fire if the cron service is missing or late. At most every 20 s per server
 * instance; alarms are claimed in the database, so nothing is sent twice.
 */
export async function dispatchIfDue(): Promise<void> {
  const mode = process.env.SCHEDULER_MODE || (process.env.VERCEL ? "external" : "inprocess");
  if (mode !== "external") return;
  const now = Date.now();
  if (now - (fallback.__ttLastFallbackDispatch ?? 0) < 20_000) return;
  fallback.__ttLastFallbackDispatch = now;
  try {
    await runDispatchOnce();
  } catch (err) {
    console.error("[fallback dispatch]", err);
  }
}

interface SchedulerState {
  timer: ReturnType<typeof setTimeout> | null;
  busy: boolean;
  stopped: boolean;
  tick: () => Promise<void>;
}

const globalState = globalThis as unknown as { __ttScheduler?: SchedulerState };

/**
 * Polling scheduler loop. Alarms live in Postgres, so nothing is lost on a
 * restart: the next pass picks up everything that became due (late alarms
 * within the grace period are still delivered). Between polls it also wakes
 * up exactly when the next alarm is due, giving ~1 s precision.
 */
export function startScheduler(opts: { intervalMs: number; log?: (msg: string) => void }): () => void {
  if (globalState.__ttScheduler && !globalState.__ttScheduler.stopped) return stopScheduler;
  const log = opts.log ?? ((m: string) => console.log(`[scheduler] ${m}`));

  const state: SchedulerState = {
    timer: null,
    busy: false,
    stopped: false,
    tick: async () => {
      if (state.stopped || state.busy) return;
      state.busy = true;
      let delay = opts.intervalMs;
      try {
        const report = await runDispatchOnce(log);
        if (report.claimed || report.completed) log(JSON.stringify(report));
        const next = await createPrismaStore(db()).nextDueAt();
        if (next) delay = Math.max(250, Math.min(opts.intervalMs, next.getTime() - Date.now() + 50));
      } catch (err) {
        log(`dispatch failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        state.busy = false;
      }
      schedule(state, delay);
    },
  };
  globalState.__ttScheduler = state;
  schedule(state, 1000);
  log(`started (poll interval ${opts.intervalMs} ms)`);
  return stopScheduler;
}

function schedule(state: SchedulerState, delay: number) {
  if (state.stopped) return;
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => void state.tick(), delay);
}

export function stopScheduler(): void {
  const state = globalState.__ttScheduler;
  if (!state) return;
  state.stopped = true;
  if (state.timer) clearTimeout(state.timer);
  globalState.__ttScheduler = undefined;
}

/**
 * Nudge the in-process loop so a newly created/edited alarm is re-evaluated
 * promptly (e.g. a reminder that is already due fires within a second).
 * No-op when the loop runs in a separate worker process.
 */
export function wakeScheduler(): void {
  const state = globalState.__ttScheduler;
  if (!state || state.stopped || state.busy) return;
  schedule(state, 200);
}
