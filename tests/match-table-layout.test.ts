import { describe, expect, it } from "vitest";
import fixture from "./fixtures/match-table-gmt10.json";
import { normalizeExtraction } from "@/lib/gemini/normalize";
import { EXTRACTION_PROMPT } from "@/lib/gemini/schema";
import { candidateFromExtraction, candidateToPayload, validateCandidate, type ScreenshotContext } from "@/lib/review/candidate";
import { suggestMerges } from "@/lib/matching/dedupe";
import { fromLocalInputValue } from "@/lib/format";
import type { SettingsDTO } from "@/lib/validation/settings";

// Table layout: MATCH | TIME (GMT+10) | LAST MATCH | STATS | EDGE.
const settings: SettingsDTO = {
  defaultReminderMinutes: 5,
  timezone: "Australia/Brisbane", // UTC+10 all year
  timezoneConfirmed: true,
  dateOrder: "DMY",
  pushEnabled: true,
  inAppEnabled: true,
  soundEnabled: true,
  includeStatsInNotification: true,
  geminiKeySource: "settings",
  geminiKeyHint: "…0000",
};

// Screenshot taken at 17:30 GMT+10 on 1 Oct 2026 (confirmed by the user).
const shot: ScreenshotContext = {
  id: "shot",
  capturedAt: "2026-10-01T07:30:00Z",
  capturedAtSource: "MANUAL",
  visibleClock: null,
  timezoneText: fixture.timezoneText,
};
const now = new Date("2026-10-01T07:31:00Z");

describe("match table layout (GMT+10, runs past midnight)", () => {
  const { result, warnings } = normalizeExtraction(fixture);
  const candidates = result.matches.map((m) => candidateFromExtraction(m, shot, settings, now));
  const startsAt = (i: number) => fromLocalInputValue(candidates[i].startsAtLocal, settings.timezone);

  it("keeps all 8 rows and passes server-side validation without warnings", () => {
    expect(result.matches).toHaveLength(8);
    expect(warnings).toEqual([]);
    expect(result.timezoneText).toBe("GMT+10");
  });

  it("maps the first row to players, competition, pick, O/U and EDGE", () => {
    expect(candidates[0]).toMatchObject({
      player1: "Darin K.",
      player2: "Varcl J.",
      competition: "CZECH LIGA PRO",
      selection: "OVER",
      ouStats: "24/9",
      ouHitRate: "73",
      edge: "47",
      pointsLine: "",
    });
    expect(candidates[1].selection).toBe("UNDER");
  });

  it("interprets times in GMT+10 and moves after-midnight rows to the next day", () => {
    expect(startsAt(0)).toBe("2026-10-01T08:00:00.000Z"); // 6:00 PM, 1 Oct
    expect(startsAt(5)).toBe("2026-10-01T13:30:00.000Z"); // 11:30 PM, 1 Oct
    expect(startsAt(6)).toBe("2026-10-01T14:15:00.000Z"); // 12:15 AM, 2 Oct
    expect(startsAt(7)).toBe("2026-10-01T14:30:00.000Z"); // 12:30 AM, 2 Oct
    expect(candidates[6].timeIssues.join(" ")).toMatch(/next day/);
    expect(candidates[0].timeIssues.join(" ")).toMatch(/capture date/);
  });

  it("asks for one confirmation of the inferred dates, then everything is valid", () => {
    expect(candidates.every((c) => c.timeStatus === "needs_confirmation")).toBe(true);
    const confirmed = candidates.map((c) => ({ ...c, timeConfirmed: true }));
    for (const c of confirmed) {
      expect(validateCandidate(c, settings.timezone, now).ok).toBe(true);
      expect(candidateToPayload(c, settings.timezone).pointsLine).toBeNull();
    }
  });

  it("leaves matches that already started unticked so they don't block the rest", () => {
    const later = new Date("2026-10-01T08:20:00Z"); // 6:20 PM GMT+10
    const list = result.matches.map((m) => candidateFromExtraction(m, { ...shot, capturedAt: later.toISOString() }, settings, later));
    expect(list[0].include).toBe(false); // 6:00 PM already started
    expect(list.slice(1).every((c) => c.include)).toBe(true);
  });

  it("does not suggest merging different matches that share a player", () => {
    const list = candidates.map((c) => ({ id: c.id, sourceId: `s-${c.id}`, player1: c.player1, player2: c.player2 }));
    expect(suggestMerges(list)).toEqual([]);
  });

  it("tells Gemini about this layout's traps", () => {
    expect(EXTRACTION_PROMPT).toMatch(/TIME \(GMT\+10\)/);
    expect(EXTRACTION_PROMPT).toMatch(/LAST MATCH/);
    expect(EXTRACTION_PROMPT).toMatch(/O18\.5/);
    expect(EXTRACTION_PROMPT).toMatch(/1U OVER/);
  });
});
