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
import { acknowledgeAlarm, changeAlarmState, createMatchWithAlarm, listRingingAlarms, updateMatch } from "@/lib/alarms/service";
import { matchInputSchema } from "@/lib/validation/match";
import { getGeminiApiKey, getSettings, updateSettings } from "@/lib/settings";
import { deleteBet, updateBet } from "@/lib/bets/service";
import { listBetRows } from "@/lib/bets/queries";
import { summarize } from "@/lib/bets/profit";

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
      `TRUNCATE "Bet", "NotificationDelivery", "InAppNotification", "Alarm", "MatchStatistics", "MatchSource", "Match", "PushSubscription", "Settings" CASCADE`,
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

  it("rings until confirmed: repeats are claimed once and stop after 'bet placed'", async () => {
    const now = new Date("2030-09-21T17:00:00Z");
    const res = await createMatchWithAlarm(prisma, input(), now);
    if (res.status !== "created") throw new Error("not created");
    await prisma.pushSubscription.create({ data: { endpoint: "https://push.example/laptop", p256dh: "k", auth: "a", deviceType: "desktop" } });
    await prisma.pushSubscription.create({ data: { endpoint: "https://push.example/phone", p256dh: "k", auth: "a", deviceType: "mobile" } });
    const sent: { endpoint: string; requireAck: boolean }[] = [];
    const push: PushSender = {
      async send(sub, payload) {
        sent.push({ endpoint: sub.endpoint, requireAck: Boolean(payload.requireAck) });
        return { ok: true };
      },
    };
    await dispatchDueAlarms({ store: createPrismaStore(prisma), push, now: () => new Date("2030-09-21T17:55:00Z") });
    expect(sent).toHaveLength(2);
    expect((await listRingingAlarms(prisma, new Date("2030-09-21T17:55:05Z"))).map((m) => m.id)).toEqual([res.match.id]);

    // Two dispatchers race for the same repeat: only one sends it, and only to the laptop.
    const at = () => new Date("2030-09-21T17:55:31Z");
    await Promise.all([
      dispatchDueAlarms({ store: createPrismaStore(prisma), push, now: at }),
      dispatchDueAlarms({ store: createPrismaStore(other), push, now: at }),
    ]);
    expect(sent.slice(2)).toEqual([{ endpoint: "https://push.example/laptop", requireAck: true }]);

    const alarmId = res.match.alarm!.id;
    const acked = await acknowledgeAlarm(prisma, alarmId, "placed", new Date("2030-09-21T17:55:40Z"));
    expect(acked.alarm?.ackAction).toBe("placed");
    expect(await listRingingAlarms(prisma, new Date("2030-09-21T17:55:45Z"))).toEqual([]);
    await dispatchDueAlarms({ store: createPrismaStore(prisma), push, now: () => new Date("2030-09-21T17:56:30Z") });
    expect(sent).toHaveLength(3);

    // Rescheduling clears the confirmation so the alarm rings again.
    const updated = await updateMatch(prisma, res.match.id, { reminderMinutes: 4 }, new Date("2030-09-21T17:55:50Z"));
    expect(updated.alarm?.ackAt).toBeNull();
  });

  it("classifies bot/personal plays and tracks bet profit in units", async () => {
    const now = new Date("2030-09-21T12:00:00Z");
    const botRes = await createMatchWithAlarm(prisma, input({ stakeUnits: 2 }), now);
    const personalRes = await createMatchWithAlarm(prisma, input({ player1: "Novak P", player2: "Kral T", selection: null, startsAt: "2030-09-21T19:00:00Z" }), now);
    if (botRes.status !== "created" || personalRes.status !== "created") throw new Error("not created");
    expect(botRes.match.playType).toBe("BOT");
    expect(personalRes.match.playType).toBe("PERSONAL");

    // "I've placed the bet" records the bet; the stake defaults to the one set at upload.
    const acked = await acknowledgeAlarm(prisma, botRes.match.alarm!.id, "placed", now, { odds: 1.9 });
    expect(acked.bet).toMatchObject({ stake: 2, odds: 1.9, result: "PENDING", profit: null });
    // Acknowledging again keeps a single bet.
    await acknowledgeAlarm(prisma, botRes.match.alarm!.id, "placed", now);
    expect(await prisma.bet.count()).toBe(1);

    const won = await updateBet(prisma, botRes.match.id, { result: "WON" }, now);
    expect(won.profit).toBe(1.8);
    expect(won.settledAt).not.toBeNull();

    // Settling a match without a recorded bet records it with 1 unit.
    const lost = await updateBet(prisma, personalRes.match.id, { result: "LOST" }, now);
    expect(lost).toMatchObject({ stake: 1, profit: -1 });

    // Skipping does not record a bet.
    const skipRes = await createMatchWithAlarm(prisma, input({ player1: "X", player2: "Y", startsAt: "2030-09-21T20:00:00Z" }), now);
    if (skipRes.status !== "created") throw new Error("not created");
    expect((await acknowledgeAlarm(prisma, skipRes.match.alarm!.id, "skipped", now)).bet).toBeNull();

    const rows = await listBetRows(prisma);
    expect(summarize(rows.filter((r) => r.playType === "BOT")).profit).toBe(1.8);
    expect(summarize(rows.filter((r) => r.playType === "PERSONAL")).profit).toBe(-1);
    expect((await listBetRows(prisma, { playType: "PERSONAL" })).map((r) => r.matchId)).toEqual([personalRes.match.id]);

    // Re-classifying a match moves its bet to the other group.
    await updateMatch(prisma, personalRes.match.id, { playType: "BOT" }, now);
    expect((await listBetRows(prisma, { playType: "BOT" })).length).toBe(2);

    // Odds filled in at upload (the average odds) become the bet's odds.
    const withOdds = await createMatchWithAlarm(prisma, input({ player1: "S", player2: "T", startsAt: "2030-09-21T22:00:00Z", stakeUnits: 1, odds: 1.85 }), now);
    if (withOdds.status !== "created") throw new Error("not created");
    expect(withOdds.match.odds).toBe(1.85);
    const placed = await acknowledgeAlarm(prisma, withOdds.match.alarm!.id, "placed", now);
    expect(placed.bet).toMatchObject({ stake: 1, odds: 1.85 });
    expect((await updateBet(prisma, withOdds.match.id, { result: "WON" }, now)).profit).toBe(0.85);
    // Changing the average-odds setting later never touches existing bets.
    await updateSettings(prisma, { useAverageOdds: true, averageOdds: 1.5 });
    await updateSettings(prisma, { useAverageOdds: false });
    expect(await prisma.bet.findUnique({ where: { matchId: withOdds.match.id } })).toMatchObject({ odds: 1.85, profit: 0.85 });
    expect(await prisma.bet.findUnique({ where: { matchId: botRes.match.id } })).toMatchObject({ odds: 1.9, profit: 1.8 });
    await deleteBet(prisma, withOdds.match.id);

    await deleteBet(prisma, botRes.match.id);
    expect(await prisma.bet.count()).toBe(1);
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
