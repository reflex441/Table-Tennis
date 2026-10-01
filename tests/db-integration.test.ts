/**
 * Integration tests against a real PostgreSQL database. They run only when
 * TEST_DATABASE_URL points to a disposable, migrated database:
 *
 *   TEST_DATABASE_URL=postgresql://... npx prisma migrate deploy   (with DATABASE_URL set to it)
 *   TEST_DATABASE_URL=postgresql://... npm test
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createPrismaStore } from "@/lib/alarms/prisma-store";
import { dispatchDueAlarms, type PushSender } from "@/lib/alarms/dispatcher";
import { changeAlarmState, createMatchWithAlarm, updateMatch } from "@/lib/alarms/service";
import { matchInputSchema } from "@/lib/validation/match";
import { getGeminiApiKey, getSettings, updateSettings } from "@/lib/settings";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("PostgreSQL integration", () => {
  let prisma: PrismaClient;
  let other: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    other = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await other?.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE "NotificationDelivery", "InAppNotification", "Alarm", "MatchStatistics", "MatchSource", "Match", "PushSubscription", "Settings" CASCADE`,
    );
  });

  const input = (over: Record<string, unknown> = {}) =>
    matchInputSchema.parse({
      player1: "Varcl J",
      player2: "Jan S",
      competition: "Czech Liga Pro",
      startsAt: "2030-09-21T18:00:00Z",
      timezone: "Europe/Prague",
      reminderMinutes: 5,
      selection: "OVER",
      ouStats: "20/9",
      ouHitRate: 69,
      edge: 47,
      ...over,
    });

  it("creates a match with statistics and an alarm at startsAt - reminder", async () => {
    const res = await createMatchWithAlarm(prisma, input(), new Date("2030-09-21T12:00:00Z"));
    expect(res.status).toBe("created");
    if (res.status !== "created") return;
    expect(res.match.alarm?.fireAt.toISOString()).toBe("2030-09-21T17:55:00.000Z");
    expect(res.match.statistics?.edge).toBe(47);
  });

  it("prevents duplicate alarms (exact and same players in either order)", async () => {
    const now = new Date("2030-09-21T12:00:00Z");
    expect((await createMatchWithAlarm(prisma, input(), now)).status).toBe("created");
    expect((await createMatchWithAlarm(prisma, input({ player1: "Jan S", player2: "Varcl J" }), now)).status).toBe("duplicate");
    expect((await createMatchWithAlarm(prisma, input({ startsAt: "2030-09-21T19:00:00Z" }), now)).status).toBe("similar");
    expect((await createMatchWithAlarm(prisma, input({ startsAt: "2030-09-21T19:00:00Z", allowSimilar: true }), now)).status).toBe("created");
    // Concurrent identical requests: the unique constraint lets only one through.
    const results = await Promise.all([1, 2, 3].map(() => createMatchWithAlarm(prisma, input({ startsAt: "2030-09-22T18:00:00Z" }), now)));
    expect(results.filter((r) => r.status === "created")).toHaveLength(1);
  });

  it("claims each due alarm exactly once across concurrent dispatchers", async () => {
    const now = new Date("2030-09-21T12:00:00Z");
    for (let i = 0; i < 10; i++) {
      await createMatchWithAlarm(prisma, input({ player1: `Player ${i}`, startsAt: `2030-09-21T18:${String(i).padStart(2, "0")}:00Z` }), now);
    }
    await prisma.pushSubscription.create({ data: { endpoint: "https://push.example/1", p256dh: "k", auth: "a" } });
    const sent: string[] = [];
    const push: PushSender = {
      async send(_sub, payload) {
        sent.push(payload.tag);
        return { ok: true };
      },
    };
    const at = () => new Date("2030-09-21T18:00:00Z");
    const reports = await Promise.all([
      dispatchDueAlarms({ store: createPrismaStore(prisma), push, now: at, batchSize: 4 }),
      dispatchDueAlarms({ store: createPrismaStore(other), push, now: at, batchSize: 4 }),
      dispatchDueAlarms({ store: createPrismaStore(prisma), push, now: at, batchSize: 4 }),
    ]);
    // Second round picks up whatever the first round's batch limits left behind.
    await dispatchDueAlarms({ store: createPrismaStore(prisma), push, now: at });
    expect(new Set(sent).size).toBe(sent.length);
    // Matches at 18:00-18:05 are due at 18:00 (5 min reminder).
    expect(sent).toHaveLength(6);
    expect(reports.reduce((n, r) => n + r.claimed, 0)).toBeLessThanOrEqual(6);
    expect(await prisma.inAppNotification.count()).toBe(6);
    expect(await prisma.notificationDelivery.count({ where: { status: "SENT" } })).toBe(6);
  });

  it("stores the Gemini key server-side and never exposes it in settings", async () => {
    const key = "AIzaSyD-test-key-for-integration-0000";
    const saved = await updateSettings(prisma, { geminiApiKey: key });
    expect(saved.geminiKeySource).toBe("settings");
    expect(saved.geminiKeyHint).toBe("…0000");
    expect(JSON.stringify(await getSettings(prisma))).not.toContain(key);
    expect(await getGeminiApiKey(prisma)).toBe(key);
    const removed = await updateSettings(prisma, { geminiApiKey: null });
    expect(removed.geminiKeySource).toBe(process.env.GEMINI_API_KEY ? "env" : "none");
  });

  it("reschedules on edit and ignores cancelled alarms", async () => {
    const now = new Date("2030-09-21T12:00:00Z");
    const res = await createMatchWithAlarm(prisma, input(), now);
    if (res.status !== "created") throw new Error("not created");
    const updated = await updateMatch(prisma, res.match.id, { reminderMinutes: 15 }, now);
    expect(updated.alarm?.fireAt.toISOString()).toBe("2030-09-21T17:45:00.000Z");
    expect(updated.alarm?.generation).toBe(2);

    await changeAlarmState(prisma, res.match.id, "cancel", now);
    const report = await dispatchDueAlarms({ store: createPrismaStore(prisma), push: null, now: () => new Date("2030-09-21T17:50:00Z") });
    expect(report.claimed).toBe(0);

    const reactivated = await changeAlarmState(prisma, res.match.id, "reactivate", now);
    expect(reactivated.alarm?.status).toBe("SCHEDULED");
  });
});
