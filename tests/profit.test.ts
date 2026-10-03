import { describe, expect, it } from "vitest";
import { computeProfit, defaultStake, formatMoney, formatUnits, summarize, summarizeBy, type BetRow } from "@/lib/bets/profit";
import { ackSchema, betInputSchema, matchInputSchema } from "@/lib/validation/match";
import { settingsUpdateSchema, type SettingsDTO } from "@/lib/validation/settings";
import { candidateFromExtraction, candidateToPayload, mergeCandidates, type ScreenshotContext } from "@/lib/review/candidate";
import { normalizeExtraction } from "@/lib/gemini/normalize";
import type { ExtractedMatch } from "@/lib/gemini/types";

const row = (over: Partial<BetRow>): BetRow => ({
  id: Math.random().toString(36),
  matchId: "m",
  playType: "BOT",
  competition: "Czech Liga Pro",
  stake: 1,
  odds: 1.9,
  result: "PENDING",
  profit: null,
  placedAt: "2026-10-01T10:00:00Z",
  ...over,
});

const settled = (over: Partial<BetRow>): BetRow => {
  const r = row(over);
  return { ...r, profit: computeProfit(r.stake, r.odds, r.result) };
};

describe("profit maths (units)", () => {
  it("computes profit from stake and decimal odds", () => {
    expect(computeProfit(1, 1.85, "WON")).toBe(0.85);
    expect(computeProfit(2, 1.9, "WON")).toBe(1.8);
    expect(computeProfit(2, 1.9, "LOST")).toBe(-2);
    expect(computeProfit(2, 1.9, "VOID")).toBe(0);
    expect(computeProfit(2, 1.9, "PENDING")).toBeNull();
    // A win without odds has no known profit (never guessed).
    expect(computeProfit(1, null, "WON")).toBeNull();
  });

  it("summarises bets: win rate, staked, profit, ROI", () => {
    const rows = [
      settled({ result: "WON", stake: 1, odds: 1.9 }),
      settled({ result: "WON", stake: 2, odds: 1.8 }),
      settled({ result: "LOST", stake: 1 }),
      settled({ result: "VOID", stake: 1 }),
      row({ result: "PENDING" }),
      row({ result: "WON", odds: null, profit: null }),
    ];
    const s = summarize(rows);
    expect(s.bets).toBe(6);
    expect(s.pending).toBe(1);
    expect(s.missingOdds).toBe(1);
    expect([s.won, s.lost, s.void, s.settled]).toEqual([2, 1, 1, 4]);
    expect(s.winRate).toBe(66.67);
    expect(s.staked).toBe(4); // void stakes are not counted
    expect(s.profit).toBe(1.5); // 0.9 + 1.6 - 1
    expect(s.roi).toBe(37.5);
    expect(summarize([]).roi).toBeNull();
  });

  it("compares bot vs personal and ranks groups by profit", () => {
    const rows = [
      settled({ playType: "BOT", result: "WON", odds: 2 }),
      settled({ playType: "PERSONAL", result: "LOST", stake: 2 }),
      settled({ playType: "PERSONAL", result: "WON", odds: 1.5 }),
    ];
    const groups = summarizeBy(rows, (r) => r.playType);
    expect(groups.map((g) => [g.key, g.summary.profit])).toEqual([
      ["BOT", 1],
      ["PERSONAL", -1.5],
    ]);
  });

  it("defaults the stake to what was set at upload, else 1u", () => {
    expect(defaultStake(2)).toBe(2);
    expect(defaultStake(null)).toBe(1);
    expect(defaultStake(0)).toBe(1);
  });

  it("formats units with the money amount from the unit size", () => {
    expect(formatUnits(2.345)).toBe("+2.35u");
    expect(formatUnits(-1)).toBe("-1u");
    expect(formatUnits(0)).toBe("0u");
    expect(formatUnits(1.5, false)).toBe("1.5u");
    expect(formatMoney(2.35, 10, "$")).toBe("+$23.50");
    expect(formatMoney(-1.5, 20, "$")).toBe("-$30.00");
    expect(formatMoney(1, 25, "€", false)).toBe("€25.00");
    expect(formatMoney(null, 10, "$")).toBe("–");
  });
});

describe("bet validation", () => {
  it("accepts units and decimal odds", () => {
    expect(betInputSchema.parse({ stake: 1.5, odds: 1.85, result: "WON" })).toEqual({ stake: 1.5, odds: 1.85, result: "WON" });
    expect(betInputSchema.safeParse({ stake: 0 }).success).toBe(false);
    expect(betInputSchema.safeParse({ odds: 1 }).success).toBe(false);
    expect(betInputSchema.safeParse({ result: "MAYBE" }).success).toBe(false);
    expect(ackSchema.parse({})).toEqual({ action: "placed" });
    expect(ackSchema.parse({ action: "placed", stake: 2, odds: 1.9 })).toEqual({ action: "placed", stake: 2, odds: 1.9 });
  });

  it("validates unit size and currency settings", () => {
    expect(settingsUpdateSchema.parse({ unitSize: 25, currency: "$" })).toEqual({ unitSize: 25, currency: "$" });
    expect(settingsUpdateSchema.safeParse({ unitSize: 0 }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ currency: "" }).success).toBe(false);
    expect(settingsUpdateSchema.parse({ useAverageOdds: true, averageOdds: 1.9 })).toEqual({ useAverageOdds: true, averageOdds: 1.9 });
    expect(settingsUpdateSchema.safeParse({ averageOdds: 1 }).success).toBe(false);
  });

  it("keeps an explicit play type on match input", () => {
    const base = { player1: "A", player2: "B", startsAt: "2030-01-01T10:00:00Z", timezone: "Australia/Sydney", reminderMinutes: 5 };
    expect(matchInputSchema.parse({ ...base, playType: "PERSONAL", selection: "OVER" }).playType).toBe("PERSONAL");
    expect(matchInputSchema.parse(base).playType).toBeUndefined();
  });
});

describe("bot vs personal classification", () => {
  const settings = {
    defaultReminderMinutes: 5,
    timezone: "Australia/Sydney",
    timezoneConfirmed: true,
    dateOrder: "DMY",
    pushEnabled: true,
    inAppEnabled: true,
    soundEnabled: true,
    includeStatsInNotification: true,
    screenshotsAreToday: true,
    screenshotTimesAreLocal: true,
    ringUntilAck: true,
    repeatSeconds: 30,
    alarmVolume: 15,
    alarmSound: "siren",
    unitSize: 10,
    currency: "$",
    useAverageOdds: false,
    averageOdds: 1.85,
    geminiModel: "gemini-3.5-flash-lite",
    geminiFallbackModel: "gemini-3.8-flash",
    showOnLeaderboard: true,
  tailPlayType: null,
    leagueLinks: [],
    geminiKeySource: "none",
    geminiKeyHint: null,
  } as SettingsDTO;
  const shot: ScreenshotContext = { id: "S", capturedAt: "2026-10-01T08:00:00Z", capturedAtSource: "EXIF", visibleClock: null, timezoneText: null };
  const m = (over: Partial<ExtractedMatch>): ExtractedMatch => ({
    player1: "Varcl J",
    player2: "Jan S",
    competition: "Czech Liga Pro",
    timeText: "9:35 PM",
    dateText: null,
    selection: null,
    pointsLine: null,
    ouStats: null,
    ouHitRate: null,
    edge: null,
    stakeUnits: null,
    confidence: null,
    ...over,
  });
  const now = new Date("2026-10-01T08:00:00Z");

  it("a row with an OVER/UNDER pick badge is a bot play with the badge stake", () => {
    const c = candidateFromExtraction(m({ selection: "OVER", stakeUnits: 1, ouStats: "12/17", ouHitRate: 71 }), shot, settings, now);
    expect(c.playType).toBe("BOT");
    const payload = candidateToPayload(c, settings.timezone);
    expect(payload.playType).toBe("BOT");
    expect(payload.stakeUnits).toBe(1);
    expect(payload.odds).toBeNull(); // average odds not ticked
  });

  it("a row without a pick is a personal play", () => {
    const c = candidateFromExtraction(m({}), shot, settings, now);
    expect(c.playType).toBe("PERSONAL");
    expect(candidateToPayload(c, settings.timezone).stakeUnits).toBe(1);
  });

  it("new uploads default to 1u and the average odds when ticked (even with a 2U badge)", () => {
    const c = candidateFromExtraction(m({ selection: "OVER", stakeUnits: 2 }), shot, { ...settings, useAverageOdds: true, averageOdds: 1.87 }, now);
    expect([c.stakeUnits, c.odds]).toEqual(["1", "1.87"]);
    expect(candidateToPayload(c, settings.timezone)).toMatchObject({ stakeUnits: 1, odds: 1.87 });
    // The odds can be changed on the review screen.
    expect(candidateToPayload({ ...c, odds: "2.05", stakeUnits: "1.5" }, settings.timezone)).toMatchObject({ stakeUnits: 1.5, odds: 2.05 });
  });

  it("merging keeps BOT if either screenshot had the pick", () => {
    const a = candidateFromExtraction(m({}), shot, settings, now);
    const b = candidateFromExtraction(m({ selection: "UNDER", stakeUnits: 2 }), shot, settings, now);
    const merged = mergeCandidates(a, b);
    expect(merged.playType).toBe("BOT");
    expect(merged.stakeUnits).toBe("1");
  });

  it("reads the badge stake from Gemini output and rejects nonsense", () => {
    const { result, warnings } = normalizeExtraction({
      matches: [
        { player1: "A", player2: "B", selection: "OVER", stakeUnits: "2" },
        { player1: "C", player2: "D", stakeUnits: 500 },
      ],
    });
    expect(result.matches.map((x) => x.stakeUnits)).toEqual([2, null]);
    expect(warnings).toHaveLength(1);
  });
});
