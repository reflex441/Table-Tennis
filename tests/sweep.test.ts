import { describe, expect, it } from "vitest";
import { normalizeExtraction } from "@/lib/gemini/normalize";
import { EXTRACTION_JSON_SCHEMA, EXTRACTION_PROMPT } from "@/lib/gemini/schema";
import { matchInputSchema } from "@/lib/validation/match";
import { candidateFromExtraction, candidateToPayload, type ScreenshotContext } from "@/lib/review/candidate";
import { statsLine } from "@/lib/alarms/notification-content";
import { summarize, computeProfit, type BetRow } from "@/lib/bets/profit";
import { SELECTIONS, isSelection } from "@/lib/selection";
import type { SettingsDTO } from "@/lib/validation/settings";

const settings = {
  defaultReminderMinutes: 5,
  timezone: "Australia/Sydney",
  screenshotsAreToday: true,
  screenshotTimesAreLocal: true,
  useAverageOdds: false,
  averageOdds: 1.85,
} as SettingsDTO;
const shot: ScreenshotContext = { id: "S", capturedAt: "2026-10-01T08:00:00Z", capturedAtSource: "EXIF", visibleClock: null, timezoneText: null };

describe("SWEEP pick", () => {
  it("is a valid selection everywhere", () => {
    expect(SELECTIONS).toEqual(["OVER", "UNDER", "SWEEP", "POINTS_SPREAD", "SET_SPREAD"]);
    expect(isSelection("SWEEP")).toBe(true);
    expect(isSelection("sweep")).toBe(false);
    const base = { player1: "A", player2: "B", startsAt: "2030-01-01T10:00:00Z", timezone: "Australia/Sydney", reminderMinutes: 5 };
    expect(matchInputSchema.parse({ ...base, selection: "SWEEP" }).selection).toBe("SWEEP");
    expect(matchInputSchema.safeParse({ ...base, selection: "SPLIT" }).success).toBe(false);
  });

  it("is never picked by a scan: the O/U % decides (under 50% = UNDER)", () => {
    const { result, warnings } = normalizeExtraction({
      matches: [
        { player1: "Zapala K.", player2: "Gola B.", competition: "TT CUP", timeText: "9:35 PM", selection: "sweep", stakeUnits: 1, ouStats: "11/12", ouHitRate: 48 },
        { player1: "Kolek M.", player2: "Lamparski M.", competition: "TT CUP", timeText: "9:50 PM", selection: "SWEEP", ouStats: "18/12", ouHitRate: 60 },
        { player1: "Varcl J.", player2: "Jan S.", competition: "TT CUP", timeText: "10:05 PM", selection: "SWEEP" },
      ],
    });
    expect(warnings).toEqual([]);
    expect(result.matches[0].selection).toBe("SWEEP");
    const [badge, misread, noStats] = result.matches.map((m) => candidateFromExtraction(m, shot, settings, new Date("2026-10-01T08:00:00Z")));
    // A "1U SWEEP" badge is still a bot play, but the pick comes from the O/U %.
    expect(badge).toMatchObject({ playType: "BOT", selection: "UNDER" });
    expect(candidateToPayload(badge, settings.timezone)).toMatchObject({ selection: "UNDER", playType: "BOT" });
    // SWEEP read without a badge stake (the SWEEP statistic): a personal play.
    expect(misread).toMatchObject({ playType: "PERSONAL", selection: "OVER" });
    expect(noStats).toMatchObject({ playType: "PERSONAL", selection: "" });
    // SWEEP can still be chosen by hand.
    expect(candidateToPayload({ ...badge, selection: "SWEEP" }, settings.timezone)).toMatchObject({ selection: "SWEEP" });
  });

  it("tells Gemini about SWEEP badges but not the SWEEP statistic", () => {
    expect(EXTRACTION_JSON_SCHEMA.properties.matches.items.properties.selection.enum).toContain("SWEEP");
    expect(EXTRACTION_PROMPT).toMatch(/"1U SWEEP \(\.\.\.\)" means SWEEP/);
    expect(EXTRACTION_PROMPT).toMatch(/"SWEEP 35%" statistic .* is NOT a pick/);
  });

  it("shows in notifications and summarises per pick", () => {
    expect(statsLine({ selection: "SWEEP", pointsLine: null, ouStats: "11/12", ouHitRate: 48, edge: 8 })).toMatch(/^SWEEP/);
    const row = (selection: "OVER" | "UNDER" | "SWEEP", result: "WON" | "LOST"): BetRow & { selection: string } => ({
      id: Math.random().toString(36), matchId: "m", playType: "BOT", competition: null, stake: 1, odds: 2, result,
      profit: computeProfit(1, 2, result), placedAt: "", selection,
    });
    const rows = [row("SWEEP", "WON"), row("SWEEP", "WON"), row("OVER", "LOST")];
    expect(summarize(rows.filter((r) => r.selection === "SWEEP"))).toMatchObject({ won: 2, profit: 2, roi: 100 });
  });
});
