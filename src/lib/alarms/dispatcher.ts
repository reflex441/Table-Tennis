import { buildAlarmNotification, type NotificationMatch, type NotificationPayload } from "./notification-content";

/**
 * Alarm dispatcher. Storage and push delivery are injected so this logic can
 * be exercised in unit tests and reused by every scheduler entry point
 * (in-process loop, standalone worker, external cron endpoint).
 *
 * Guarantees:
 *  - Alarms are claimed atomically (SKIP LOCKED), so concurrent dispatchers
 *    never process the same alarm at the same time.
 *  - Each subscription receives a given alarm schedule at most once
 *    (unique delivery record per alarm/generation/subscription).
 *  - The in-app notification for an alarm schedule is created at most once.
 *  - Transient push failures are retried with backoff until the match starts.
 *  - If the dispatcher crashes mid-send, the stale lock is reclaimed later.
 */

export const MAX_ATTEMPTS = 4;
export const STALE_LOCK_MS = 2 * 60_000;
/** Notifications are still sent this long after the match started (e.g. after downtime). */
export const LATE_GRACE_MS = 5 * 60_000;

export interface ClaimedAlarm {
  id: string;
  /** Owner of the match: their settings and devices are used. */
  userId: string | null;
  generation: number;
  attempts: number;
  reminderMinutes: number;
  fireAt: Date;
  match: NotificationMatch;
}

export interface SubscriptionRecord {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  /** "desktop" rings until confirmed; "mobile" gets one normal notification. */
  deviceType?: "desktop" | "mobile";
}

const isDesktop = (sub: SubscriptionRecord) => sub.deviceType !== "mobile";

export interface DispatchSettings {
  timezone: string;
  pushEnabled: boolean;
  inAppEnabled: boolean;
  includeStatsInNotification: boolean;
  /** Keep re-sending the push until the user confirms the bet. */
  ringUntilAck: boolean;
  repeatSeconds: number;
}

export type PushResult =
  | { ok: true }
  | { ok: false; permanent: boolean; statusCode?: number; error: string };

export interface PushSender {
  send(sub: SubscriptionRecord, payload: NotificationPayload, ttlSeconds: number): Promise<PushResult>;
}

export interface FinishUpdate {
  status: "SCHEDULED" | "TRIGGERED" | "FAILED";
  nextAttemptAt?: Date;
  lastError: string | null;
  triggeredAt?: Date;
  /** When to repeat the push while the alarm rings (null = never). */
  nextRepeatAt?: Date | null;
}

export interface DispatcherStore {
  claimDue(now: Date, limit: number): Promise<ClaimedAlarm[]>;
  /** The alarm owner's notification settings. */
  getSettings(userId: string | null): Promise<DispatchSettings>;
  /** The alarm owner's devices. */
  getActiveSubscriptions(userId: string | null): Promise<SubscriptionRecord[]>;
  getDeliveredSubscriptionIds(alarmId: string, generation: number): Promise<Set<string>>;
  recordDelivery(alarmId: string, generation: number, subscriptionId: string, result: PushResult): Promise<void>;
  markSubscription(subscriptionId: string, result: PushResult, now: Date): Promise<void>;
  /** Returns true if a new notification was created (false if it already existed). */
  createInAppNotification(alarmId: string, generation: number, payload: NotificationPayload, userId: string | null): Promise<boolean>;
  /** Only applies if the alarm is still SENDING with the same generation. */
  finishAlarm(alarmId: string, generation: number, update: FinishUpdate): Promise<boolean>;
  /** Move TRIGGERED alarms whose match has started to COMPLETED. */
  completeStartedAlarms(now: Date): Promise<number>;
  /**
   * Atomically claim triggered, unconfirmed alarms whose repeat is due and
   * whose match hasn't started (only for owners with "ring until confirmed"
   * and push on), moving their next repeat ahead by the owner's interval.
   */
  claimRepeats(now: Date, limit: number): Promise<(ClaimedAlarm & { repeatCount: number })[]>;
  nextDueAt(): Promise<Date | null>;
}

export interface DispatchReport {
  claimed: number;
  triggered: number;
  retried: number;
  failed: number;
  pushSent: number;
  pushFailed: number;
  completed: number;
  /** Repeated "still ringing" pushes sent this pass. */
  repeated: number;
}

export function retryDelayMs(attempt: number): number {
  return Math.min(5 * 60_000, 15_000 * 2 ** Math.max(0, attempt - 1));
}

export async function dispatchDueAlarms(deps: {
  store: DispatcherStore;
  push: PushSender | null;
  now?: () => Date;
  batchSize?: number;
  log?: (msg: string) => void;
}): Promise<DispatchReport> {
  const nowFn = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  const report: DispatchReport = { claimed: 0, triggered: 0, retried: 0, failed: 0, pushSent: 0, pushFailed: 0, completed: 0, repeated: 0 };

  const claimed = await deps.store.claimDue(nowFn(), deps.batchSize ?? 50);
  report.claimed = claimed.length;

  // Each alarm uses its owner's settings and devices (cached per pass).
  const settingsCache = new Map<string, Promise<DispatchSettings>>();
  const subsCache = new Map<string, Promise<SubscriptionRecord[]>>();
  const settingsFor = (userId: string | null) => {
    const key = userId ?? "";
    if (!settingsCache.has(key)) settingsCache.set(key, deps.store.getSettings(userId));
    return settingsCache.get(key)!;
  };
  const subscriptionsFor = (userId: string | null) => {
    const key = userId ?? "";
    if (!subsCache.has(key)) subsCache.set(key, deps.store.getActiveSubscriptions(userId));
    return subsCache.get(key)!;
  };

  if (claimed.length) {
    for (const alarm of claimed) {
      try {
        const settings = await settingsFor(alarm.userId);
        const subscriptions = settings.pushEnabled && deps.push ? await subscriptionsFor(alarm.userId) : [];
        const outcome = await processAlarm(alarm, settings, subscriptions, deps.store, deps.push, nowFn(), log);
        report.pushSent += outcome.pushSent;
        report.pushFailed += outcome.pushFailed;
        if (outcome.status === "TRIGGERED") report.triggered++;
        else if (outcome.status === "SCHEDULED") report.retried++;
        else report.failed++;
      } catch (err) {
        // Unexpected error (e.g. DB hiccup): release the alarm for retry.
        const message = err instanceof Error ? err.message : String(err);
        log(`alarm ${alarm.id}: unexpected error ${message}`);
        const now = nowFn();
        const canRetry = alarm.attempts < MAX_ATTEMPTS && now.getTime() < alarm.match.startsAt.getTime() + LATE_GRACE_MS;
        await deps.store
          .finishAlarm(alarm.id, alarm.generation, canRetry
            ? { status: "SCHEDULED", nextAttemptAt: new Date(now.getTime() + retryDelayMs(alarm.attempts)), lastError: message }
            : { status: "FAILED", lastError: message })
          .catch(() => {});
        if (canRetry) report.retried++;
        else report.failed++;
      }
    }
  }

  // "Ring until confirmed": re-send the push for triggered alarms nobody has
  // confirmed yet, so a locked phone keeps alerting until the bet is placed.
  if (deps.push) {
    const repeats = await deps.store.claimRepeats(nowFn(), deps.batchSize ?? 50);
    if (repeats.length) {
      for (const alarm of repeats) {
        const settings = await settingsFor(alarm.userId);
        // Repeats go to computers only: phones get a single notification.
        const subscriptions = (await subscriptionsFor(alarm.userId)).filter(isDesktop);
        const now = nowFn();
        const payload = buildAlarmNotification({
          match: alarm.match,
          alarmId: alarm.id,
          generation: alarm.generation,
          timezone: settings.timezone,
          includeStats: settings.includeStatsInNotification,
          now,
          repeat: alarm.repeatCount,
        });
        const ttlSeconds = Math.max(30, Math.round((alarm.match.startsAt.getTime() - now.getTime()) / 1000));
        for (const sub of subscriptions) {
          let result: PushResult;
          try {
            result = await deps.push.send(sub, { ...payload, requireAck: true }, ttlSeconds);
          } catch (err) {
            result = { ok: false, permanent: false, error: err instanceof Error ? err.message : String(err) };
          }
          await deps.store.markSubscription(sub.id, result, now);
          if (result.ok) report.pushSent++;
          else report.pushFailed++;
        }
        report.repeated++;
      }
    }
  }

  report.completed = await deps.store.completeStartedAlarms(nowFn());
  return report;
}

async function processAlarm(
  alarm: ClaimedAlarm,
  settings: DispatchSettings,
  subscriptions: SubscriptionRecord[],
  store: DispatcherStore,
  push: PushSender | null,
  now: Date,
  log: (msg: string) => void,
): Promise<{ status: FinishUpdate["status"]; pushSent: number; pushFailed: number }> {
  const startsAt = alarm.match.startsAt.getTime();

  if (now.getTime() > startsAt + LATE_GRACE_MS) {
    const lastError = "Missed: the scheduler was not running when this alarm was due.";
    await store.finishAlarm(alarm.id, alarm.generation, { status: "FAILED", lastError });
    log(`alarm ${alarm.id}: missed`);
    return { status: "FAILED", pushSent: 0, pushFailed: 0 };
  }

  const payload = buildAlarmNotification({
    match: alarm.match,
    alarmId: alarm.id,
    generation: alarm.generation,
    timezone: settings.timezone,
    includeStats: settings.includeStatsInNotification,
    now,
  });

  let inAppDelivered = false;
  if (settings.inAppEnabled) {
    await store.createInAppNotification(alarm.id, alarm.generation, payload, alarm.userId);
    inAppDelivered = true;
  }

  let pushSent = 0;
  let pushFailed = 0;
  let transientFailures = 0;
  const errors: string[] = [];
  let alreadyDelivered = 0;

  if (push && subscriptions.length) {
    const delivered = await store.getDeliveredSubscriptionIds(alarm.id, alarm.generation);
    // Pushes expire when the match starts; a stale reminder is useless.
    const ttlSeconds = Math.max(60, Math.round((startsAt - now.getTime()) / 1000) + 300);
    for (const sub of subscriptions) {
      if (delivered.has(sub.id)) {
        alreadyDelivered++;
        continue;
      }
      let result: PushResult;
      try {
        // Computers get a lingering "confirm your bet" alert; phones a normal one.
        result = await push.send(sub, { ...payload, requireAck: settings.ringUntilAck && isDesktop(sub) }, ttlSeconds);
      } catch (err) {
        result = { ok: false, permanent: false, error: err instanceof Error ? err.message : String(err) };
      }
      await store.recordDelivery(alarm.id, alarm.generation, sub.id, result);
      await store.markSubscription(sub.id, result, now);
      if (result.ok) {
        pushSent++;
      } else {
        pushFailed++;
        errors.push(result.statusCode ? `${result.statusCode}: ${result.error}` : result.error);
        if (!result.permanent) transientFailures++;
      }
    }
  }

  const anyDelivered = inAppDelivered || pushSent > 0 || alreadyDelivered > 0;
  const canRetry = transientFailures > 0 && alarm.attempts < MAX_ATTEMPTS && now.getTime() < startsAt;
  const lastError = errors.length ? `Push delivery failed for ${errors.length} device(s): ${errors.join("; ").slice(0, 500)}` : null;

  if (canRetry) {
    await store.finishAlarm(alarm.id, alarm.generation, {
      status: "SCHEDULED",
      nextAttemptAt: new Date(now.getTime() + retryDelayMs(alarm.attempts)),
      lastError,
    });
    return { status: "SCHEDULED", pushSent, pushFailed };
  }

  if (!anyDelivered) {
    const reason = lastError ?? "No notification channel is available: enable in-app notifications or subscribe a device to push notifications.";
    await store.finishAlarm(alarm.id, alarm.generation, { status: "FAILED", lastError: reason });
    return { status: "FAILED", pushSent, pushFailed };
  }

  const nextRepeatAt = settings.ringUntilAck ? new Date(now.getTime() + settings.repeatSeconds * 1000) : null;
  await store.finishAlarm(alarm.id, alarm.generation, { status: "TRIGGERED", triggeredAt: now, lastError, nextRepeatAt });
  log(`alarm ${alarm.id}: triggered (push sent ${pushSent}, failed ${pushFailed})`);
  return { status: "TRIGGERED", pushSent, pushFailed };
}
