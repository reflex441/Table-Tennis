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
    expect(SELECTIONS).toEqual(["OVER", "UNDER", "SWEEP"]);
    expect(isSelection("SWEEP")).toBe(true);
    expect(isSelection("sweep")).toBe(false);
    const base = { player1: "A", player2: "B", startsAt: "2030-01-01T10:00:00Z", timezone: "Australia/Sydney", reminderMinutes: 5 };
    expect(matchInputSchema.parse({ ...base, selection: "SWEEP" }).selection).toBe("SWEEP");
    expect(matchInputSchema.safeParse({ ...base, selection: "SPLIT" }).success).toBe(false);
  });

  it("is read from Gemini output and makes a bot play", () => {
    const { result, warnings } = normalizeExtraction({
      matches: [{ player1: "Zapala K.", player2: "Gola B.", competition: "TT CUP", timeText: "9:35 PM", selection: "sweep", stakeUnits: 1 }],
    });
    expect(warnings).toEqual([]);
    expect(result.matches[0].selection).toBe("SWEEP");
    const c = candidateFromExtraction(result.matches[0], shot, settings, new Date("2026-10-01T08:00:00Z"));
    expect(c.playType).toBe("BOT");
    expect(candidateToPayload(c, settings.timezone)).toMatchObject({ selection: "SWEEP", playType: "BOT" });
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
