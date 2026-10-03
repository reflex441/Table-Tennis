import { describe, expect, it } from "vitest";
import { candidateFromExtraction, emptyCandidate, mergeCandidates, type ScreenshotContext } from "@/lib/review/candidate";
import { personalPick } from "@/lib/selection";
import type { ExtractedMatch } from "@/lib/gemini/types";
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
const extracted = (over: Partial<ExtractedMatch>): ExtractedMatch => ({
  player1: "Zochniak J.",
  player2: "Kolek M.",
  competition: "TT ELITE",
  timeText: "3:15 PM",
  dateText: null,
  selection: null,
  pointsLine: null,
  ouStats: "28/22",
  ouHitRate: 56,
  edge: 32,
  stakeUnits: null,
  confidence: 0.9,
  ...over,
});

describe("personal plays pick from the O/U %", () => {
  it("over 50% is OVER, under 50% is UNDER, 50% or nothing is unpicked", () => {
    expect(personalPick(56, "28/22")).toBe("OVER");
    expect(personalPick(50.5, null)).toBe("OVER");
    expect(personalPick(44, "22/28")).toBe("UNDER");
    expect(personalPick(50, "25/25")).toBeNull();
    expect(personalPick(null, null)).toBeNull();
    // No percentage: worked out from the O/U record.
    expect(personalPick(null, "18/12")).toBe("OVER");
    expect(personalPick(null, "12/18")).toBe("UNDER");
  });

  it("applies to scanned personal plays and leaves bot picks alone", () => {
    const personal = candidateFromExtraction(extracted({}), shot, settings);
    expect(personal).toMatchObject({ playType: "PERSONAL", selection: "OVER" });
    expect(candidateFromExtraction(extracted({ ouHitRate: 41, ouStats: "18/26" }), shot, settings)).toMatchObject({ playType: "PERSONAL", selection: "UNDER" });
    expect(candidateFromExtraction(extracted({ ouHitRate: 50, ouStats: "25/25" }), shot, settings).selection).toBe("");
    // A bot badge always wins, even against the %.
    expect(candidateFromExtraction(extracted({ selection: "UNDER" }), shot, settings)).toMatchObject({ playType: "BOT", selection: "UNDER" });
    expect(emptyCandidate(null, settings).selection).toBe("");
  });

  it("combining a personal play with a bot play keeps the bot's pick", () => {
    const personal = candidateFromExtraction(extracted({}), shot, settings);
    const bot = candidateFromExtraction(extracted({ selection: "UNDER" }), shot, settings);
    const merged = mergeCandidates(personal, bot);
    expect(merged).toMatchObject({ playType: "BOT", selection: "UNDER" });
    expect(merged.conflicts.find((c) => c.field === "selection")).toBeUndefined();
    expect(mergeCandidates(bot, personal)).toMatchObject({ playType: "BOT", selection: "UNDER" });
  });

  it("bot plays keep the badge's units (1.5U OVER -> 1.5u)", () => {
    expect(candidateFromExtraction(extracted({ selection: "OVER", stakeUnits: 1.5 }), shot, settings)).toMatchObject({ playType: "BOT", stakeUnits: "1.5" });
    expect(candidateFromExtraction(extracted({ selection: "OVER", stakeUnits: 1 }), shot, settings).stakeUnits).toBe("1");
    expect(candidateFromExtraction(extracted({}), shot, settings).stakeUnits).toBe("1"); // personal: 1u
    const merged = mergeCandidates(candidateFromExtraction(extracted({}), shot, settings), candidateFromExtraction(extracted({ selection: "OVER", stakeUnits: 1.5 }), shot, settings));
    expect(merged).toMatchObject({ playType: "BOT", stakeUnits: "1.5" });
  });
});
