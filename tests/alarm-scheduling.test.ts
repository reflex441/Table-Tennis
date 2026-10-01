import { describe, expect, it } from "vitest";
import { checkSchedule, computeFireAt, sectionForStatus } from "@/lib/alarms/schedule";
import {
  dispatchDueAlarms,
  LATE_GRACE_MS,
  MAX_ATTEMPTS,
  STALE_LOCK_MS,
  type ClaimedAlarm,
  type DispatcherStore,
  type FinishUpdate,
  type PushResult,
  type PushSender,
  type SubscriptionRecord,
} from "@/lib/alarms/dispatcher";
import { buildAlarmNotification } from "@/lib/alarms/notification-content";

describe("computeFireAt / checkSchedule", () => {
  it("fires 5 minutes before an 18:00 match at 17:55", () => {
    const startsAt = new Date("2026-09-21T18:00:00Z");
    expect(computeFireAt(startsAt, 5).toISOString()).toBe("2026-09-21T17:55:00.000Z");
  });

  it.each([1, 3, 5, 10, 15, 30, 45])("supports a %i minute reminder", (m) => {
    const startsAt = new Date("2026-09-21T18:00:00Z");
    expect(startsAt.getTime() - computeFireAt(startsAt, m).getTime()).toBe(m * 60_000);
  });

  it("rejects matches that already started", () => {
    const r = checkSchedule(new Date("2026-09-21T18:00:00Z"), 5, new Date("2026-09-21T18:00:01Z"));
    expect(r.ok).toBe(false);
  });

  it("fires immediately when the reminder time has passed but the match hasn't started", () => {
    const r = checkSchedule(new Date("2026-09-21T18:00:00Z"), 30, new Date("2026-09-21T17:50:00Z"));
    expect(r).toMatchObject({ ok: true, immediate: true });
  });

  it("maps statuses to dashboard sections", () => {
    expect(sectionForStatus("SCHEDULED")).toBe("upcoming");
    expect(sectionForStatus("SENDING")).toBe("upcoming");
    expect(sectionForStatus("TRIGGERED")).toBe("triggered");
    expect(sectionForStatus("FAILED")).toBe("triggered");
    expect(sectionForStatus("COMPLETED")).toBe("completed");
    expect(sectionForStatus("CANCELLED")).toBe("cancelled");
  });
});

// ---------------------------------------------------------------------------
// In-memory store mirroring the Prisma store's semantics.
// ---------------------------------------------------------------------------
interface MemAlarm {
  id: string;
  status: "SCHEDULED" | "SENDING" | "TRIGGERED" | "COMPLETED" | "CANCELLED" | "FAILED";
  generation: number;
  attempts: number;
  nextAttemptAt: Date;
  fireAt: Date;
  lockedAt: Date | null;
  lastError: string | null;
  triggeredAt: Date | null;
  reminderMinutes: number;
  startsAt: Date;
  ackAt?: Date | null;
  nextRepeatAt?: Date | null;
  repeatCount?: number;
}

function createMemoryStore(opts: { alarms: MemAlarm[]; subs?: SubscriptionRecord[]; inAppEnabled?: boolean; pushEnabled?: boolean; ringUntilAck?: boolean; repeatSeconds?: number }) {
  const alarms = new Map(opts.alarms.map((a) => [a.id, a]));
  const subs = new Map((opts.subs ?? []).map((s) => [s.id, { ...s, active: true }]));
  const deliveries = new Map<string, { status: "SENT" | "FAILED"; attempts: number }>();
  const inApp = new Set<string>();

  const store: DispatcherStore = {
    async claimDue(now, limit) {
      const stale = now.getTime() - STALE_LOCK_MS;
      const due = [...alarms.values()]
        .filter((a) => (a.status === "SCHEDULED" && a.nextAttemptAt <= now) || (a.status === "SENDING" && a.lockedAt && a.lockedAt.getTime() < stale))
        .sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime())
        .slice(0, limit);
      return due.map<ClaimedAlarm>((a) => {
        a.status = "SENDING";
        a.lockedAt = now;
        a.attempts += 1;
        return {
          id: a.id,
          userId: "u1",
          generation: a.generation,
          attempts: a.attempts,
          reminderMinutes: a.reminderMinutes,
          fireAt: a.fireAt,
          match: {
            id: `m-${a.id}`,
            player1: "Varcl J",
            player2: "Jan S",
            competition: "Czech Liga Pro",
            startsAt: a.startsAt,
            statistics: { selection: "OVER", pointsLine: null, ouStats: "20/9", ouHitRate: 69, edge: 47 },
          },
        };
      });
    },
    async getSettings() {
      return {
        timezone: "UTC",
        pushEnabled: opts.pushEnabled ?? true,
        inAppEnabled: opts.inAppEnabled ?? true,
        includeStatsInNotification: true,
        ringUntilAck: opts.ringUntilAck ?? false,
        repeatSeconds: opts.repeatSeconds ?? 30,
      };
    },
    async getActiveSubscriptions() {
      return [...subs.values()].filter((s) => s.active);
    },
    async getDeliveredSubscriptionIds(alarmId, generation) {
      return new Set(
        [...deliveries.entries()].filter(([k, v]) => k.startsWith(`${alarmId}:${generation}:`) && v.status === "SENT").map(([k]) => k.split(":")[2]),
      );
    },
    async recordDelivery(alarmId, generation, subscriptionId, result: PushResult) {
      const key = `${alarmId}:${generation}:${subscriptionId}`;
      const prev = deliveries.get(key);
      deliveries.set(key, { status: result.ok ? "SENT" : "FAILED", attempts: (prev?.attempts ?? 0) + 1 });
    },
    async markSubscription(id, result) {
      if (!result.ok && result.permanent) subs.get(id)!.active = false;
    },
    async createInAppNotification(alarmId, generation) {
      const key = `${alarmId}:${generation}`;
      if (inApp.has(key)) return false;
      inApp.add(key);
      return true;
    },
    async finishAlarm(alarmId, generation, update: FinishUpdate) {
      const a = alarms.get(alarmId);
      if (!a || a.generation !== generation || a.status !== "SENDING") return false;
      a.status = update.status;
      a.lockedAt = null;
      a.lastError = update.lastError;
      if (update.nextAttemptAt) a.nextAttemptAt = update.nextAttemptAt;
      if (update.triggeredAt) a.triggeredAt = update.triggeredAt;
      if (update.nextRepeatAt !== undefined) a.nextRepeatAt = update.nextRepeatAt;
      return true;
    },
    async claimRepeats(now, limit) {
      if (!(opts.ringUntilAck ?? false) || !(opts.pushEnabled ?? true)) return [];
      const due = [...alarms.values()]
        .filter((a) => a.status === "TRIGGERED" && !a.ackAt && a.nextRepeatAt && a.nextRepeatAt <= now && a.startsAt > now)
        .slice(0, limit);
      return due.map((a) => {
        a.nextRepeatAt = new Date(now.getTime() + (opts.repeatSeconds ?? 30) * 1000);
        a.repeatCount = (a.repeatCount ?? 0) + 1;
        return {
          id: a.id,
          userId: "u1",
          generation: a.generation,
          attempts: a.attempts,
          reminderMinutes: a.reminderMinutes,
          fireAt: a.fireAt,
          repeatCount: a.repeatCount,
          match: {
            id: `m-${a.id}`,
            player1: "Varcl J",
            player2: "Jan S",
            competition: "Czech Liga Pro",
            startsAt: a.startsAt,
            statistics: { selection: "OVER" as const, pointsLine: null, ouStats: "20/9", ouHitRate: 69, edge: 47 },
          },
        };
      });
    },
    async completeStartedAlarms(now) {
      let n = 0;
      for (const a of alarms.values()) {
        if (a.status === "TRIGGERED" && a.startsAt <= now) {
          a.status = "COMPLETED";
          n++;
        }
      }
      return n;
    },
    async nextDueAt() {
      const next = [...alarms.values()].filter((a) => a.status === "SCHEDULED").sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime())[0];
      return next?.nextAttemptAt ?? null;
    },
  };
  return { store, alarms, subs, deliveries, inApp };
}

const START = new Date("2026-09-21T18:00:00Z");
function alarm(id: string, reminderMinutes = 5, startsAt = START): MemAlarm {
  const fireAt = computeFireAt(startsAt, reminderMinutes);
  return { id, status: "SCHEDULED", generation: 1, attempts: 0, nextAttemptAt: fireAt, fireAt, lockedAt: null, lastError: null, triggeredAt: null, reminderMinutes, startsAt };
}

function pushSender(behaviour: (sub: SubscriptionRecord, call: number) => PushResult) {
  const calls: { sub: string; title: string; ttl: number; requireAck: boolean }[] = [];
  const sender: PushSender = {
    async send(sub, payload, ttl) {
      calls.push({ sub: sub.id, title: payload.title, ttl, requireAck: Boolean(payload.requireAck) });
      return behaviour(sub, calls.length);
    },
  };
  return { sender, calls };
}

const sub = (id: string): SubscriptionRecord => ({ id, endpoint: `https://push.example/${id}`, p256dh: "k", auth: "a" });
const at = (iso: string) => () => new Date(iso);

describe("dispatchDueAlarms", () => {
  it("does not fire before the reminder time", async () => {
    const mem = createMemoryStore({ alarms: [alarm("a1")], subs: [sub("s1")] });
    const { sender, calls } = pushSender(() => ({ ok: true }));
    const report = await dispatchDueAlarms({ store: mem.store, push: sender, now: at("2026-09-21T17:54:59Z") });
    expect(report.claimed).toBe(0);
    expect(calls).toHaveLength(0);
    expect(mem.alarms.get("a1")!.status).toBe("SCHEDULED");
  });

  it("fires at 17:55 for an 18:00 match with a 5 minute reminder", async () => {
    const mem = createMemoryStore({ alarms: [alarm("a1")], subs: [sub("s1"), sub("s2")] });
    const { sender, calls } = pushSender(() => ({ ok: true }));
    const report = await dispatchDueAlarms({ store: mem.store, push: sender, now: at("2026-09-21T17:55:00Z") });
    expect(report).toMatchObject({ claimed: 1, triggered: 1, pushSent: 2 });
    expect(calls.map((c) => c.sub)).toEqual(["s1", "s2"]);
    expect(calls[0].title).toBe("Varcl J vs Jan S");
    // TTL lasts until the match starts (+5 min).
    expect(calls[0].ttl).toBe(600);
    expect(mem.alarms.get("a1")!.status).toBe("TRIGGERED");
    expect(mem.inApp.size).toBe(1);
  });

  it("never sends the same alarm twice, even when dispatchers run concurrently", async () => {
    const mem = createMemoryStore({ alarms: [alarm("a1"), alarm("a2", 10)], subs: [sub("s1")] });
    const { sender, calls } = pushSender(() => ({ ok: true }));
    const now = at("2026-09-21T17:56:00Z");
    await Promise.all([
      dispatchDueAlarms({ store: mem.store, push: sender, now }),
      dispatchDueAlarms({ store: mem.store, push: sender, now }),
      dispatchDueAlarms({ store: mem.store, push: sender, now }),
    ]);
    await dispatchDueAlarms({ store: mem.store, push: sender, now: at("2026-09-21T17:57:00Z") });
    expect(calls).toHaveLength(2);
    expect(mem.inApp.size).toBe(2);
  });

  it("retries transient push failures without re-sending to devices that already got it", async () => {
    const mem = createMemoryStore({ alarms: [alarm("a1")], subs: [sub("ok"), sub("flaky")] });
    const { sender, calls } = pushSender((s, n) => (s.id === "flaky" && n <= 2 ? { ok: false, permanent: false, statusCode: 503, error: "unavailable" } : { ok: true }));

    const first = await dispatchDueAlarms({ store: mem.store, push: sender, now: at("2026-09-21T17:55:00Z") });
    expect(first.retried).toBe(1);
    const a = mem.alarms.get("a1")!;
    expect(a.status).toBe("SCHEDULED");
    expect(a.nextAttemptAt.toISOString()).toBe("2026-09-21T17:55:15.000Z");
    expect(mem.inApp.size).toBe(1);

    const second = await dispatchDueAlarms({ store: mem.store, push: sender, now: at("2026-09-21T17:55:15Z") });
    expect(second.triggered).toBe(1);
    expect(calls.map((c) => c.sub)).toEqual(["ok", "flaky", "flaky"]);
    expect(a.status).toBe("TRIGGERED");
    expect(mem.inApp.size).toBe(1); // still only one in-app notification
  });

  it("gives up retrying after MAX_ATTEMPTS but keeps the alarm triggered via in-app", async () => {
    const mem = createMemoryStore({ alarms: [alarm("a1")], subs: [sub("s1")] });
    const { sender } = pushSender(() => ({ ok: false, permanent: false, error: "timeout" }));
    let t = new Date("2026-09-21T17:55:00Z").getTime();
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await dispatchDueAlarms({ store: mem.store, push: sender, now: () => new Date(t) });
      t += 2 * 60_000;
    }
    const a = mem.alarms.get("a1")!;
    expect(a.attempts).toBe(MAX_ATTEMPTS);
    // Triggered on the last attempt, then completed because the match started.
    expect(a.triggeredAt).not.toBeNull();
    expect(a.status).toBe("COMPLETED");
    expect(a.lastError).toMatch(/Push delivery failed/);
  });

  it("deactivates expired subscriptions (410)", async () => {
    const mem = createMemoryStore({ alarms: [alarm("a1")], subs: [sub("gone")] });
    const { sender } = pushSender(() => ({ ok: false, permanent: true, statusCode: 410, error: "expired" }));
    await dispatchDueAlarms({ store: mem.store, push: sender, now: at("2026-09-21T17:55:00Z") });
    expect(mem.subs.get("gone")!.active).toBe(false);
    expect(mem.alarms.get("a1")!.status).toBe("TRIGGERED"); // in-app delivered
  });

  it("fails when no channel is available", async () => {
    const mem = createMemoryStore({ alarms: [alarm("a1")], subs: [], inAppEnabled: false });
    await dispatchDueAlarms({ store: mem.store, push: null, now: at("2026-09-21T17:55:00Z") });
    expect(mem.alarms.get("a1")!.status).toBe("FAILED");
    expect(mem.alarms.get("a1")!.lastError).toMatch(/No notification channel/);
  });

  it("still delivers late alarms after a restart, within the grace period", async () => {
    const mem = createMemoryStore({ alarms: [alarm("a1")], subs: [sub("s1")] });
    const { sender, calls } = pushSender(() => ({ ok: true }));
    await dispatchDueAlarms({ store: mem.store, push: sender, now: at("2026-09-21T17:59:00Z") });
    expect(calls).toHaveLength(1);
  });

  it("marks alarms as missed when the server was down past the match start", async () => {
    const mem = createMemoryStore({ alarms: [alarm("a1")], subs: [sub("s1")] });
    const { sender, calls } = pushSender(() => ({ ok: true }));
    await dispatchDueAlarms({ store: mem.store, push: sender, now: () => new Date(START.getTime() + LATE_GRACE_MS + 1000) });
    expect(calls).toHaveLength(0);
    expect(mem.alarms.get("a1")!.status).toBe("FAILED");
    expect(mem.alarms.get("a1")!.lastError).toMatch(/Missed/);
  });

  it("reclaims alarms whose dispatcher crashed mid-send", async () => {
    const a = alarm("a1");
    a.status = "SENDING";
    a.lockedAt = new Date("2026-09-21T17:55:00Z");
    const mem = createMemoryStore({ alarms: [a], subs: [sub("s1")] });
    const { sender, calls } = pushSender(() => ({ ok: true }));
    await dispatchDueAlarms({ store: mem.store, push: sender, now: at("2026-09-21T17:56:00Z") });
    expect(calls).toHaveLength(0); // lock still fresh
    await dispatchDueAlarms({ store: mem.store, push: sender, now: at("2026-09-21T17:57:01Z") });
    expect(calls).toHaveLength(1);
  });

  it("does not overwrite an alarm that was edited while sending", async () => {
    const mem = createMemoryStore({ alarms: [alarm("a1")], subs: [sub("s1")] });
    const sender: PushSender = {
      async send() {
        // User reschedules the alarm mid-delivery.
        const a = mem.alarms.get("a1")!;
        a.generation += 1;
        a.status = "SCHEDULED";
        return { ok: true };
      },
    };
    await dispatchDueAlarms({ store: mem.store, push: sender, now: at("2026-09-21T17:55:00Z") });
    expect(mem.alarms.get("a1")!.status).toBe("SCHEDULED");
    expect(mem.alarms.get("a1")!.generation).toBe(2);
  });

  it("moves triggered alarms to completed once the match starts", async () => {
    const mem = createMemoryStore({ alarms: [alarm("a1")], subs: [] });
    await dispatchDueAlarms({ store: mem.store, push: null, now: at("2026-09-21T17:55:00Z") });
    expect(mem.alarms.get("a1")!.status).toBe("TRIGGERED");
    const report = await dispatchDueAlarms({ store: mem.store, push: null, now: at("2026-09-21T18:00:00Z") });
    expect(report.completed).toBe(1);
    expect(mem.alarms.get("a1")!.status).toBe("COMPLETED");
  });
});

describe("ring until the bet is confirmed (computers) / one notification (phones)", () => {
  const laptop: SubscriptionRecord = { ...sub("laptop"), deviceType: "desktop" };
  const phone: SubscriptionRecord = { ...sub("phone"), deviceType: "mobile" };

  it("sends a lingering alert to computers and a normal one to phones", async () => {
    const mem = createMemoryStore({ alarms: [alarm("a1")], subs: [laptop, phone], ringUntilAck: true });
    const { sender, calls } = pushSender(() => ({ ok: true }));
    await dispatchDueAlarms({ store: mem.store, push: sender, now: at("2026-09-21T17:55:00Z") });
    expect(calls.map((c) => [c.sub, c.requireAck])).toEqual([
      ["laptop", true],
      ["phone", false],
    ]);
    expect(mem.alarms.get("a1")!.nextRepeatAt?.toISOString()).toBe("2026-09-21T17:55:30.000Z");
  });

  it("repeats every 30 s on computers only, until confirmed", async () => {
    const mem = createMemoryStore({ alarms: [alarm("a1")], subs: [laptop, phone], ringUntilAck: true });
    const { sender, calls } = pushSender(() => ({ ok: true }));
    await dispatchDueAlarms({ store: mem.store, push: sender, now: at("2026-09-21T17:55:00Z") });
    await dispatchDueAlarms({ store: mem.store, push: sender, now: at("2026-09-21T17:55:20Z") }); // not due yet
    const r1 = await dispatchDueAlarms({ store: mem.store, push: sender, now: at("2026-09-21T17:55:30Z") });
    const r2 = await dispatchDueAlarms({ store: mem.store, push: sender, now: at("2026-09-21T17:56:00Z") });
    expect(r1.repeated + r2.repeated).toBe(2);
    const repeats = calls.slice(2);
    expect(repeats.map((c) => c.sub)).toEqual(["laptop", "laptop"]); // phone never repeated
    expect(repeats.every((c) => c.requireAck && c.title.startsWith("⏰"))).toBe(true);

    mem.alarms.get("a1")!.ackAt = new Date("2026-09-21T17:56:10Z"); // "I've placed the bet"
    await dispatchDueAlarms({ store: mem.store, push: sender, now: at("2026-09-21T17:56:30Z") });
    expect(calls).toHaveLength(4);
  });

  it("stops ringing when the match starts", async () => {
    const mem = createMemoryStore({ alarms: [alarm("a1", 1)], subs: [laptop], ringUntilAck: true });
    const { sender, calls } = pushSender(() => ({ ok: true }));
    await dispatchDueAlarms({ store: mem.store, push: sender, now: at("2026-09-21T17:59:00Z") });
    await dispatchDueAlarms({ store: mem.store, push: sender, now: at("2026-09-21T18:00:01Z") });
    expect(calls).toHaveLength(1);
    expect(mem.alarms.get("a1")!.status).toBe("COMPLETED");
  });

  it("sends a single normal alert everywhere when ringing is switched off", async () => {
    const mem = createMemoryStore({ alarms: [alarm("a1")], subs: [laptop, phone], ringUntilAck: false });
    const { sender, calls } = pushSender(() => ({ ok: true }));
    await dispatchDueAlarms({ store: mem.store, push: sender, now: at("2026-09-21T17:55:00Z") });
    await dispatchDueAlarms({ store: mem.store, push: sender, now: at("2026-09-21T17:56:00Z") });
    expect(calls.map((c) => c.requireAck)).toEqual([false, false]);
    expect(mem.alarms.get("a1")!.nextRepeatAt).toBeNull();
  });
});

describe("buildAlarmNotification", () => {
  it("includes players, competition, start time, selection, O/U and EDGE", () => {
    const p = buildAlarmNotification({
      match: {
        id: "m1",
        player1: "Varcl J",
        player2: "Jan S",
        competition: "Czech Liga Pro",
        startsAt: new Date("2026-09-21T16:00:00Z"),
        statistics: { selection: "OVER", pointsLine: 74.5, ouStats: "20/9", ouHitRate: 69, edge: 47 },
      },
      alarmId: "a1",
      generation: 2,
      timezone: "Europe/Prague",
      includeStats: true,
      now: new Date("2026-09-21T15:55:00Z"),
    });
    expect(p.title).toBe("Varcl J vs Jan S");
    expect(p.body).toBe("Czech Liga Pro - 18:00 (starts in 5 min)\nOVER 74.5 | O/U 20/9 - 69% | EDGE 47%");
    expect(p.url).toBe("/matches/m1");
    expect(p.tag).toBe("alarm-a1");
  });

  it("omits statistics when disabled or missing", () => {
    const p = buildAlarmNotification({
      match: { id: "m1", player1: "A", player2: "B", competition: null, startsAt: new Date("2026-09-21T16:00:00Z"), statistics: null },
      alarmId: "a1",
      generation: 1,
      timezone: "UTC",
      includeStats: true,
      now: new Date("2026-09-21T16:00:00Z"),
    });
    expect(p.body).toBe("16:00 (starting now)");
  });
});
