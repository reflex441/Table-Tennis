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
import { authenticate, registerUser, signInWithGoogle, updateDisplayName } from "@/lib/auth/accounts";
import { getMatch, listMatches } from "@/lib/alarms/queries";
import { deleteMatch } from "@/lib/alarms/service";
import { getLeaderboard } from "@/lib/leaderboard";
import { getSessionSecret } from "@/lib/auth/session";
import { copyBets, getTailProfile, listTailing, tail, untail } from "@/lib/tailing";
import { setAvatar, toPublicUser } from "@/lib/auth/accounts";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("PostgreSQL integration", () => {
  let prisma: PrismaClient;
  let other: PrismaClient;
  let userId: string;

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
      `TRUNCATE "Bet", "NotificationDelivery", "InAppNotification", "Alarm", "MatchStatistics", "MatchSource", "Match", "PushSubscription", "Settings", "Screenshot", "Follow", "User", "AppSecret" CASCADE`,
    );
    userId = (await prisma.user.create({ data: { email: "owner@example.com", name: "Owner" } })).id;
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
    const res = await createMatchWithAlarm(prisma, userId, input(), new Date("2030-09-21T12:00:00Z"));
    expect(res.status).toBe("created");
    if (res.status !== "created") return;
    expect(res.match.alarm?.fireAt.toISOString()).toBe("2030-09-21T17:55:00.000Z");
    expect(res.match.statistics?.edge).toBe(47);
  });

  it("prevents duplicate alarms (exact and same players in either order)", async () => {
    const now = new Date("2030-09-21T12:00:00Z");
    expect((await createMatchWithAlarm(prisma, userId, input(), now)).status).toBe("created");
    expect((await createMatchWithAlarm(prisma, userId, input({ player1: "Jan S", player2: "Varcl J" }), now)).status).toBe("duplicate");
    expect((await createMatchWithAlarm(prisma, userId, input({ startsAt: "2030-09-21T19:00:00Z" }), now)).status).toBe("similar");
    expect((await createMatchWithAlarm(prisma, userId, input({ startsAt: "2030-09-21T19:00:00Z", allowSimilar: true }), now)).status).toBe("created");
    // Concurrent identical requests: the unique constraint lets only one through.
    const results = await Promise.all([1, 2, 3].map(() => createMatchWithAlarm(prisma, userId, input({ startsAt: "2030-09-22T18:00:00Z" }), now)));
    expect(results.filter((r) => r.status === "created")).toHaveLength(1);
  });

  it("claims each due alarm exactly once across concurrent dispatchers", async () => {
    const now = new Date("2030-09-21T12:00:00Z");
    for (let i = 0; i < 10; i++) {
      await createMatchWithAlarm(prisma, userId, input({ player1: `Player ${i}`, startsAt: `2030-09-21T18:${String(i).padStart(2, "0")}:00Z` }), now);
    }
    await prisma.pushSubscription.create({ data: { endpoint: "https://push.example/1", p256dh: "k", auth: "a", userId } });
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
    const saved = await updateSettings(prisma, userId, { geminiApiKey: key });
    expect(saved.geminiKeySource).toBe("settings");
    expect(saved.geminiKeyHint).toBe("…0000");
    expect(JSON.stringify(await getSettings(prisma, userId))).not.toContain(key);
    expect(await getGeminiApiKey(prisma, userId)).toBe(key);
    const removed = await updateSettings(prisma, userId, { geminiApiKey: null });
    expect(removed.geminiKeySource).toBe("none");
  });

  it("rings until confirmed: repeats are claimed once and stop after 'bet placed'", async () => {
    const now = new Date("2030-09-21T17:00:00Z");
    const res = await createMatchWithAlarm(prisma, userId, input(), now);
    if (res.status !== "created") throw new Error("not created");
    await prisma.pushSubscription.create({ data: { endpoint: "https://push.example/laptop", p256dh: "k", auth: "a", deviceType: "desktop", userId } });
    await prisma.pushSubscription.create({ data: { endpoint: "https://push.example/phone", p256dh: "k", auth: "a", deviceType: "mobile", userId } });
    const sent: { endpoint: string; requireAck: boolean }[] = [];
    const push: PushSender = {
      async send(sub, payload) {
        sent.push({ endpoint: sub.endpoint, requireAck: Boolean(payload.requireAck) });
        return { ok: true };
      },
    };
    await dispatchDueAlarms({ store: createPrismaStore(prisma), push, now: () => new Date("2030-09-21T17:55:00Z") });
    expect(sent).toHaveLength(2);
    expect((await listRingingAlarms(prisma, userId, new Date("2030-09-21T17:55:05Z"))).map((m) => m.id)).toEqual([res.match.id]);

    // Two dispatchers race for the same repeat: only one sends it, and only to the laptop.
    const at = () => new Date("2030-09-21T17:55:31Z");
    await Promise.all([
      dispatchDueAlarms({ store: createPrismaStore(prisma), push, now: at }),
      dispatchDueAlarms({ store: createPrismaStore(other), push, now: at }),
    ]);
    expect(sent.slice(2)).toEqual([{ endpoint: "https://push.example/laptop", requireAck: true }]);

    const alarmId = res.match.alarm!.id;
    const acked = await acknowledgeAlarm(prisma, userId, alarmId, "placed", new Date("2030-09-21T17:55:40Z"));
    expect(acked.alarm?.ackAction).toBe("placed");
    expect(await listRingingAlarms(prisma, userId, new Date("2030-09-21T17:55:45Z"))).toEqual([]);
    await dispatchDueAlarms({ store: createPrismaStore(prisma), push, now: () => new Date("2030-09-21T17:56:30Z") });
    expect(sent).toHaveLength(3);

    // Rescheduling clears the confirmation so the alarm rings again.
    const updated = await updateMatch(prisma, userId, res.match.id, { reminderMinutes: 4 }, new Date("2030-09-21T17:55:50Z"));
    expect(updated.alarm?.ackAt).toBeNull();
  });

  it("classifies bot/personal plays and tracks bet profit in units", async () => {
    const now = new Date("2030-09-21T12:00:00Z");
    const botRes = await createMatchWithAlarm(prisma, userId, input({ stakeUnits: 2 }), now);
    const personalRes = await createMatchWithAlarm(prisma, userId, input({ player1: "Novak P", player2: "Kral T", selection: null, startsAt: "2030-09-21T19:00:00Z" }), now);
    if (botRes.status !== "created" || personalRes.status !== "created") throw new Error("not created");
    expect(botRes.match.playType).toBe("BOT");
    expect(personalRes.match.playType).toBe("PERSONAL");

    // "I've placed the bet" records the bet; the stake defaults to the one set at upload.
    const acked = await acknowledgeAlarm(prisma, userId, botRes.match.alarm!.id, "placed", now, { odds: 1.9 });
    expect(acked.bet).toMatchObject({ stake: 2, odds: 1.9, result: "PENDING", profit: null });
    // Acknowledging again keeps a single bet.
    await acknowledgeAlarm(prisma, userId, botRes.match.alarm!.id, "placed", now);
    expect(await prisma.bet.count()).toBe(1);

    const won = await updateBet(prisma, userId, botRes.match.id, { result: "WON" }, now);
    expect(won.profit).toBe(1.8);
    expect(won.settledAt).not.toBeNull();

    // Settling a match without a recorded bet records it with 1 unit.
    const lost = await updateBet(prisma, userId, personalRes.match.id, { result: "LOST" }, now);
    expect(lost).toMatchObject({ stake: 1, profit: -1 });

    // Skipping does not record a bet.
    const skipRes = await createMatchWithAlarm(prisma, userId, input({ player1: "X", player2: "Y", startsAt: "2030-09-21T20:00:00Z" }), now);
    if (skipRes.status !== "created") throw new Error("not created");
    expect((await acknowledgeAlarm(prisma, userId, skipRes.match.alarm!.id, "skipped", now)).bet).toBeNull();

    const rows = await listBetRows(prisma, userId);
    expect(summarize(rows.filter((r) => r.playType === "BOT")).profit).toBe(1.8);
    expect(summarize(rows.filter((r) => r.playType === "PERSONAL")).profit).toBe(-1);
    expect((await listBetRows(prisma, userId, { playType: "PERSONAL" })).map((r) => r.matchId)).toEqual([personalRes.match.id]);

    // Re-classifying a match moves its bet to the other group.
    await updateMatch(prisma, userId, personalRes.match.id, { playType: "BOT" }, now);
    expect((await listBetRows(prisma, userId, { playType: "BOT" })).length).toBe(2);

    // Odds filled in at upload (the average odds) become the bet's odds.
    const withOdds = await createMatchWithAlarm(prisma, userId, input({ player1: "S", player2: "T", startsAt: "2030-09-21T22:00:00Z", stakeUnits: 1, odds: 1.85 }), now);
    if (withOdds.status !== "created") throw new Error("not created");
    expect(withOdds.match.odds).toBe(1.85);
    const placed = await acknowledgeAlarm(prisma, userId, withOdds.match.alarm!.id, "placed", now);
    expect(placed.bet).toMatchObject({ stake: 1, odds: 1.85 });
    expect((await updateBet(prisma, userId, withOdds.match.id, { result: "WON" }, now)).profit).toBe(0.85);
    // Changing the average-odds setting later never touches existing bets.
    await updateSettings(prisma, userId, { useAverageOdds: true, averageOdds: 1.5 });
    await updateSettings(prisma, userId, { useAverageOdds: false });
    expect(await prisma.bet.findUnique({ where: { matchId: withOdds.match.id } })).toMatchObject({ odds: 1.85, profit: 0.85 });
    expect(await prisma.bet.findUnique({ where: { matchId: botRes.match.id } })).toMatchObject({ odds: 1.9, profit: 1.8 });
    await deleteBet(prisma, userId, withOdds.match.id);

    await deleteBet(prisma, userId, botRes.match.id);
    expect(await prisma.bet.count()).toBe(1);
  });

  it("reschedules on edit and ignores cancelled alarms", async () => {
    const now = new Date("2030-09-21T12:00:00Z");
    const res = await createMatchWithAlarm(prisma, userId, input(), now);
    if (res.status !== "created") throw new Error("not created");
    const updated = await updateMatch(prisma, userId, res.match.id, { reminderMinutes: 15 }, now);
    expect(updated.alarm?.fireAt.toISOString()).toBe("2030-09-21T17:45:00.000Z");
    expect(updated.alarm?.generation).toBe(2);

    await changeAlarmState(prisma, userId, res.match.id, "cancel", now);
    const report = await dispatchDueAlarms({ store: createPrismaStore(prisma), push: null, now: () => new Date("2030-09-21T17:50:00Z") });
    expect(report.claimed).toBe(0);

    const reactivated = await changeAlarmState(prisma, userId, res.match.id, "reactivate", now);
    expect(reactivated.alarm?.status).toBe("SCHEDULED");
  });

  it("first account takes over data created before accounts; later accounts start empty", async () => {
    await prisma.user.deleteMany();
    const orphan = await prisma.match.create({ data: { player1: "A", player2: "B", startsAt: new Date("2030-09-21T18:00:00Z"), timezone: "UTC", dedupeKey: "orphan" } });
    await prisma.settings.create({ data: { unitSize: 25 } });
    const first = await registerUser(prisma, { email: " Will@Example.com ", name: "Will", password: "correct horse" });
    expect(first.email).toBe("will@example.com");
    expect((await prisma.match.findUnique({ where: { id: orphan.id } }))!.userId).toBe(first.id);
    expect((await getSettings(prisma, first.id)).unitSize).toBe(25);
    const second = await registerUser(prisma, { email: "sam@example.com", name: "Sam", password: "another one" });
    expect(await listMatches(prisma, second.id, null)).toEqual([]);
    expect((await getSettings(prisma, second.id)).unitSize).toBe(10);
    // Each account has its own Gemini key.
    await updateSettings(prisma, first.id, { geminiApiKey: "AIzaSyFirstUsersKey000000000000000" });
    expect(await getGeminiApiKey(prisma, second.id)).toBe("");

    await expect(registerUser(prisma, { email: "WILL@example.com", name: "x", password: "whatever1" })).rejects.toMatchObject({ status: 409 });
    expect((await authenticate(prisma, "will@example.com", "correct horse"))?.id).toBe(first.id);
    expect(await authenticate(prisma, "will@example.com", "wrong")).toBeNull();
    expect(await authenticate(prisma, "nobody@example.com", "correct horse")).toBeNull();
  });

  it("Google sign-in links to the account with the same verified email, or creates one", async () => {
    const linked = await signInWithGoogle(prisma, { sub: "g-1", email: "OWNER@example.com", emailVerified: true, name: "Owner G" });
    expect(linked.id).toBe(userId);
    expect(linked.googleId).toBe("g-1");
    expect((await signInWithGoogle(prisma, { sub: "g-1", email: "changed@example.com", emailVerified: true, name: null })).id).toBe(userId);
    const fresh = await signInWithGoogle(prisma, { sub: "g-2", email: "new@example.com", emailVerified: true, name: "New Person" });
    expect(fresh).toMatchObject({ email: "new@example.com", name: "New Person", passwordHash: null });
    await expect(signInWithGoogle(prisma, { sub: "g-3", email: "x@example.com", emailVerified: false, name: null })).rejects.toMatchObject({ status: 403 });
  });

  it("keeps each account's matches, alarms and devices separate", async () => {
    const bob = (await prisma.user.create({ data: { email: "bob@example.com", name: "Bob" } })).id;
    const now = new Date("2030-09-21T12:00:00Z");
    const mine = await createMatchWithAlarm(prisma, userId, input(), now);
    // The same match is not a duplicate for another account.
    const his = await createMatchWithAlarm(prisma, bob, input(), now);
    if (mine.status !== "created" || his.status !== "created") throw new Error("not created");

    expect((await listMatches(prisma, bob, null)).map((m) => m.id)).toEqual([his.match.id]);
    expect(await getMatch(prisma, bob, mine.match.id)).toBeNull();
    await expect(updateMatch(prisma, bob, mine.match.id, { notes: "hacked" }, now)).rejects.toMatchObject({ status: 404 });
    await expect(changeAlarmState(prisma, bob, mine.match.id, "cancel", now)).rejects.toMatchObject({ status: 404 });
    await expect(acknowledgeAlarm(prisma, bob, mine.match.alarm!.id, "placed", now)).rejects.toMatchObject({ status: 404 });
    await expect(updateBet(prisma, bob, mine.match.id, { result: "WON" }, now)).rejects.toMatchObject({ status: 404 });
    await expect(deleteMatch(prisma, bob, mine.match.id)).rejects.toMatchObject({ status: 404 });
    expect(await getMatch(prisma, userId, mine.match.id)).not.toBeNull();

    // Alarms go only to the owner's devices, using the owner's settings.
    await prisma.pushSubscription.create({ data: { endpoint: "https://push.example/mine", p256dh: "k", auth: "a", userId } });
    await prisma.pushSubscription.create({ data: { endpoint: "https://push.example/bob", p256dh: "k", auth: "a", userId: bob } });
    await updateSettings(prisma, bob, { inAppEnabled: false });
    const sent: string[] = [];
    const push: PushSender = {
      async send(sub) {
        sent.push(sub.endpoint);
        return { ok: true };
      },
    };
    await dispatchDueAlarms({ store: createPrismaStore(prisma), push, now: () => new Date("2030-09-21T17:55:00Z") });
    expect(sent.sort()).toEqual(["https://push.example/bob", "https://push.example/mine"]);
    const inApp = await prisma.inAppNotification.findMany({ select: { userId: true } });
    expect(inApp).toEqual([{ userId }]); // Bob turned in-app notifications off
  });

  it("ranks everyone by units, and by ROI only with enough settled bets", async () => {
    const mk = async (email: string, name: string) => (await prisma.user.create({ data: { email, name } })).id;
    const ann = await mk("ann@example.com", "Ann");
    const ben = await mk("ben@example.com", "Ben");
    const cat = await mk("cat@example.com", "Cat");
    let n = 0;
    const bets = async (owner: string, list: { stake: number; profit: number; result: "WON" | "LOST" | "VOID"; type?: "BOT" | "PERSONAL" }[]) => {
      for (const b of list) {
        n++;
        await prisma.match.create({
          data: {
            userId: owner,
            player1: `P${n}`,
            player2: `Q${n}`,
            startsAt: new Date(Date.UTC(2030, 0, 1, 0, n)),
            timezone: "UTC",
            dedupeKey: `k${n}`,
            playType: b.type ?? "BOT",
            bet: { create: { stake: b.stake, odds: 2, result: b.result, profit: b.profit } },
          },
        });
      }
    };
    // Ann: +3u from 10u staked (ROI 30%). Ben: +4u from 20u (ROI 20%). Cat: only 2 bets.
    await bets(ann, [{ stake: 5, profit: 5, result: "WON" }, { stake: 5, profit: -2, result: "LOST" }, { stake: 1, profit: 0, result: "VOID", type: "PERSONAL" }]);
    await bets(ben, [{ stake: 10, profit: 10, result: "WON" }, { stake: 10, profit: -6, result: "LOST" }, { stake: 1, profit: 0, result: "VOID" }]);
    await bets(cat, [{ stake: 1, profit: 50, result: "WON" }, { stake: 1, profit: 50, result: "WON" }]);

    const board = await getLeaderboard(prisma, { currentUserId: cat, minBets: 3 });
    // Units: no minimum, so Cat (2 bets) leads. ROI: only accounts with enough bets.
    expect(board.byProfit.map((r) => [r.name, r.profit, r.rank])).toEqual([["Cat", 100, 1], ["Ben", 4, 2], ["Ann", 3, 3]]);
    expect(board.byRoi.map((r) => [r.name, r.roi])).toEqual([["Ann", 30], ["Ben", 20]]);
    expect(board.me).toMatchObject({ name: "Cat", bets: 2, rankProfit: 1, rankRoi: null, hidden: false });
    expect(JSON.stringify(board)).not.toContain("@example.com");

    // Emails in LEADERBOARD_ALWAYS_SHOW are ranked by ROI below the minimum (others still need it).
    process.env.LEADERBOARD_ALWAYS_SHOW = "someone@else.com, CAT@example.com";
    try {
      const withCat = await getLeaderboard(prisma, { currentUserId: cat, minBets: 3 });
      expect(withCat.byRoi.map((r) => r.name)).toEqual(["Cat", "Ann", "Ben"]);
      expect(withCat.me).toMatchObject({ rankProfit: 1, rankRoi: 1 });
      expect(JSON.stringify(withCat)).not.toContain("@example.com");
    } finally {
      delete process.env.LEADERBOARD_ALWAYS_SHOW;
    }

    // A new display name shows on the leaderboard straight away.
    await updateDisplayName(prisma, ben, "  Benny  ");
    expect((await getLeaderboard(prisma, { currentUserId: cat, minBets: 3 })).byProfit[1].name).toBe("Benny");

    // Opting out hides the account; filtering by play type uses only those bets.
    await updateSettings(prisma, ben, { showOnLeaderboard: false });
    expect((await getLeaderboard(prisma, { currentUserId: ann, minBets: 3 })).byProfit.map((r) => r.name)).toEqual(["Cat", "Ann"]);
    expect((await getLeaderboard(prisma, { currentUserId: ann, minBets: 1, playType: "PERSONAL" })).byProfit.map((r) => r.name)).toEqual(["Ann"]);
    expect((await getLeaderboard(prisma, { currentUserId: ann })).minBets).toBe(100);
  });

  it("generates and keeps a session secret when SESSION_SECRET is not set", async () => {
    const saved = process.env.SESSION_SECRET;
    delete process.env.SESSION_SECRET;
    try {
      const secret = await getSessionSecret(prisma);
      expect(secret.length).toBeGreaterThanOrEqual(32);
      expect((await prisma.appSecret.findUnique({ where: { name: "session" } }))?.value).toBe(secret);
      expect(await getSessionSecret(other)).toBe(secret);
    } finally {
      if (saved !== undefined) process.env.SESSION_SECRET = saved;
    }
  });

  it("stores alarm volume/sound per account and keeps notifications private", async () => {
    expect(await getSettings(prisma, userId)).toMatchObject({ alarmVolume: 15, alarmSound: "siren" });
    expect(await updateSettings(prisma, userId, { alarmVolume: 40, alarmSound: "chime" })).toMatchObject({ alarmVolume: 40, alarmSound: "chime" });
    const bob = (await prisma.user.create({ data: { email: "bob@example.com", name: "Bob" } })).id;
    const mine = await prisma.inAppNotification.create({ data: { userId, title: "a", body: "", url: "/" } });
    await prisma.inAppNotification.create({ data: { userId: bob, title: "b", body: "", url: "/" } });
    // Bob can't delete my notification; clearing his own leaves mine.
    expect((await prisma.inAppNotification.deleteMany({ where: { id: mine.id, userId: bob } })).count).toBe(0);
    await prisma.inAppNotification.deleteMany({ where: { userId: bob } });
    expect(await prisma.inAppNotification.count({ where: { userId } })).toBe(1);
  });

  it("'Bet placed' early records the bet, skips the notification and moves the match to Pending", async () => {
    const now = new Date("2030-09-21T12:00:00Z");
    const res = await createMatchWithAlarm(prisma, userId, input({ stakeUnits: 1, odds: 1.87 }), now);
    if (res.status !== "created") throw new Error("not created");
    await prisma.pushSubscription.create({ data: { endpoint: "https://push.example/early", p256dh: "k", auth: "a", userId } });

    const done = await changeAlarmState(prisma, userId, res.match.id, "placed", now);
    expect(done.alarm).toMatchObject({ status: "COMPLETED", ackAction: "placed" });
    expect(done.bet).toMatchObject({ stake: 1, odds: 1.87, result: "PENDING" });

    const sent: string[] = [];
    const push: PushSender = { async send(sub) { sent.push(sub.endpoint); return { ok: true }; } };
    await dispatchDueAlarms({ store: createPrismaStore(prisma), push, now: () => new Date("2030-09-21T17:55:00Z") });
    expect(sent).toEqual([]);
    expect(await prisma.inAppNotification.count()).toBe(0);
    // Bet placed -> Pending; marking it Won moves it to Completed.
    expect((await listMatches(prisma, userId, "pending")).map((m) => m.id)).toEqual([res.match.id]);
    expect(await listMatches(prisma, userId, "completed")).toEqual([]);
    await updateBet(prisma, userId, res.match.id, { result: "WON" }, now);
    expect(await listMatches(prisma, userId, "pending")).toEqual([]);
    expect((await listMatches(prisma, userId, "completed")).map((m) => m.id)).toEqual([res.match.id]);
  });

  it("tailing: follow open accounts, see their bets, copy upcoming bets; private accounts stay hidden", async () => {
    const now = new Date("2030-09-21T12:00:00Z");
    const sam = (await prisma.user.create({ data: { email: "sam@example.com", name: "Sam" } })).id;
    const kim = (await prisma.user.create({ data: { email: "kim@example.com", name: "Kim" } })).id;
    await updateSettings(prisma, kim, { allowTailing: false });

    // Sam: two upcoming bets (one already started is not copyable) and one settled bet.
    const a = await createMatchWithAlarm(prisma, sam, input({ odds: 2.1, selection: "UNDER" }), now);
    const b = await createMatchWithAlarm(prisma, sam, input({ player1: "Kosmal D.", player2: "Minda M.", startsAt: "2030-09-21T19:00:00Z", selection: "SWEEP" }), now);
    const old = await prisma.match.create({
      data: { userId: sam, player1: "Old", player2: "Match", startsAt: new Date("2030-09-20T10:00:00Z"), timezone: "UTC", dedupeKey: "old",
        bet: { create: { stake: 1, odds: 2, result: "WON", profit: 1 } } },
    });
    if (a.status !== "created" || b.status !== "created") throw new Error("not created");

    const lists = await listTailing(prisma, userId, now);
    expect(lists.tailing).toEqual([]);
    expect(lists.others.map((x) => x.name)).toEqual(["Sam"]); // Kim turned tailing off
    expect(JSON.stringify(lists)).not.toContain("@example.com");
    await expect(tail(prisma, userId, kim)).rejects.toMatchObject({ status: 404 });
    await expect(getTailProfile(prisma, userId, kim, now)).rejects.toMatchObject({ status: 404 });
    await expect(tail(prisma, userId, userId)).rejects.toMatchObject({ status: 400 });

    await tail(prisma, userId, sam);
    await tail(prisma, userId, sam); // idempotent
    const after = await listTailing(prisma, userId, now);
    expect(after.tailing).toMatchObject([{ name: "Sam", tailed: true, upcoming: 2, summary: { profit: 1, won: 1 } }]);

    const profile = await getTailProfile(prisma, userId, sam, now);
    expect(profile.upcoming.map((m) => m.player1)).toEqual(["Varcl J", "Kosmal D."]);
    expect(profile.bets.map((r) => r.matchId)).toEqual([old.id]);
    expect(JSON.stringify(profile)).not.toMatch(/@example\.com|screenshot/i);

    // Copy one, then all: the second run skips the one already copied.
    await updateSettings(prisma, userId, { defaultReminderMinutes: 10, useAverageOdds: true, averageOdds: 1.85 });
    expect(await copyBets(prisma, userId, sam, [a.match.id], now)).toEqual({ copied: 1, skipped: [] });
    const all = await copyBets(prisma, userId, sam, null, now);
    expect(all.copied).toBe(1);
    expect(all.skipped).toHaveLength(1);
    const mine = await listMatches(prisma, userId, "upcoming");
    expect(mine).toHaveLength(2);
    expect(mine[0]).toMatchObject({ player1: "Varcl J", copiedFrom: { id: sam, name: "Sam" }, stakeUnits: 1, odds: 1.85, playType: "BOT" });
    expect(mine[0].alarm?.reminderMinutes).toBe(10);
    expect(mine[1].statistics.selection).toBe("SWEEP");
    expect((await getTailProfile(prisma, userId, sam, now)).upcoming.every((m) => m.copied)).toBe(true);
    // Their matches are untouched and still theirs.
    expect((await listMatches(prisma, sam, null)).length).toBe(3);

    await untail(prisma, userId, sam);
    expect((await listTailing(prisma, userId, now)).tailing).toEqual([]);
  });

  it("stores a profile picture and exposes only a versioned URL", async () => {
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    const user = await setAvatar(prisma, userId, { data: png, mime: "image/png" }, new Date("2030-01-01T00:00:00Z"));
    expect(toPublicUser(user).avatarUrl).toBe(`/api/users/${userId}/avatar?v=${Date.parse("2030-01-01T00:00:00Z")}`);
    expect(Buffer.from((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).avatar!)).toEqual(png);
    expect(toPublicUser(await setAvatar(prisma, userId, null)).avatarUrl).toBeNull();
  });
});
