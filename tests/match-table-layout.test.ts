import { describe, expect, it } from "vitest";
import fixture from "./fixtures/match-table-gmt10.json";
import cropped from "./fixtures/match-table-cropped.json";
import { normalizeExtraction } from "@/lib/gemini/normalize";
import { EXTRACTION_PROMPT } from "@/lib/gemini/schema";
import { candidatesFromExtraction, candidateToPayload, validateCandidate, type ScreenshotContext } from "@/lib/review/candidate";
import { suggestMerges } from "@/lib/matching/dedupe";
import { fromLocalInputValue } from "@/lib/format";
import type { SettingsDTO } from "@/lib/validation/settings";

// Table layout: MATCH | TIME (GMT+10) | LAST MATCH | STATS | EDGE.
// All users are in NSW; on 1 Oct 2026 Sydney is AEST (UTC+10).
const settings: SettingsDTO = {
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
  scanSpeed: "fast",
  ringUntilAck: true,
  repeatSeconds: 30,
  unitSize: 10,
  currency: "$",
  geminiKeySource: "settings",
  geminiKeyHint: "…0000",
};

// File date only (no status-bar clock): the common case for these screenshots.
const shotAt = (iso: string, timezoneText: string | null): ScreenshotContext => ({
  id: "shot",
  capturedAt: iso,
  capturedAtSource: "FILE_MODIFIED",
  visibleClock: null,
  timezoneText,
});

function scan(raw: unknown, captureIso: string, s: SettingsDTO = settings) {
  const { result, warnings } = normalizeExtraction(raw);
  const now = new Date(new Date(captureIso).getTime() + 60_000);
  const candidates = candidatesFromExtraction(result.matches, shotAt(captureIso, result.timezoneText), s, now);
  const startsAt = (i: number) => fromLocalInputValue(candidates[i].startsAtLocal, s.timezone);
  return { result, warnings, candidates, startsAt, now };
}

describe("match table layout - today's list", () => {
  // Screenshot taken at 5:30 PM on Thu 1 Oct.
  const { result, warnings, candidates, startsAt, now } = scan(fixture, "2026-10-01T07:30:00Z");

  it("keeps all 8 rows and passes server-side validation without warnings", () => {
    expect(result.matches).toHaveLength(8);
    expect(warnings).toEqual([]);
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

  it("puts times on today and rows after midnight on tomorrow", () => {
    expect(startsAt(0)).toBe("2026-10-01T08:00:00.000Z"); // 6:00 PM Thu 1 Oct
    expect(startsAt(5)).toBe("2026-10-01T13:30:00.000Z"); // 11:30 PM Thu 1 Oct
    expect(startsAt(6)).toBe("2026-10-01T14:15:00.000Z"); // 12:15 AM Fri 2 Oct
    expect(startsAt(7)).toBe("2026-10-01T14:30:00.000Z"); // 12:30 AM Fri 2 Oct
    expect(candidates[0].timeNotes.join(" ")).toMatch(/Today's list - Thu 01 Oct/);
    expect(candidates[7].timeNotes.join(" ")).toMatch(/After midnight in today's list - Fri 02 Oct/);
  });

  it("needs no confirmation: every row is ready to create", () => {
    for (const c of candidates) {
      expect(c.timeStatus).toBe("resolved");
      expect(c.include).toBe(true);
      expect(validateCandidate(c, settings.timezone, now).ok).toBe(true);
      expect(candidateToPayload(c, settings.timezone).pointsLine).toBeNull();
    }
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
    // The date under the points is the LAST match date - Gemini must not use it.
    expect(EXTRACTION_PROMPT).toMatch(/72 pts 29\.09\.2026[\s\S]*LAST played/);
    expect(EXTRACTION_PROMPT).toMatch(/Never put it in dateText or timeText/);
  });
});

describe("cropped screenshot with a misread timezone header", () => {
  // Taken at 6:19 PM Thu 1 Oct; Gemini read the cut-off header as "GMT+3".
  const { candidates, startsAt } = scan(cropped, "2026-10-01T08:19:00Z");

  it("ignores the misread label and reads times as Sydney time", () => {
    expect(startsAt(0)).toBe("2026-10-01T10:10:00.000Z"); // 8:10 PM Thu 1/10/2026
    expect(startsAt(6)).toBe("2026-10-01T14:30:00.000Z"); // 12:30 AM Fri 2/10/2026
    expect(candidates[0].timeNotes.join(" ")).toMatch(/"GMT\+3" in the screenshot ignored/);
    expect(candidates.every((c) => c.timeStatus === "resolved" && c.include)).toBe(true);
  });

  it("would honour the label if that setting is turned off", () => {
    const { startsAt: withLabel } = scan(cropped, "2026-10-01T08:19:00Z", { ...settings, screenshotTimesAreLocal: false });
    expect(withLabel(0)).toBe("2026-10-01T17:10:00.000Z"); // 8:10 PM GMT+3
  });
});

describe("today's-list edge cases", () => {
  const rows = (times: string[]) => ({
    matches: times.map((t, i) => ({ player1: `A${i}`, player2: `B${i}`, timeText: t })),
  });

  it("a list captured just before midnight starting after midnight is tomorrow", () => {
    const { startsAt } = scan(rows(["12:15 AM", "12:40 AM"]), "2026-10-01T13:50:00Z"); // 11:50 PM
    expect(startsAt(0)).toBe("2026-10-01T14:15:00.000Z"); // 12:15 AM Fri 2 Oct
  });

  it("a match that just started stays today and is unticked", () => {
    const { candidates } = scan(rows(["6:00 PM", "8:10 PM"]), "2026-10-01T08:19:00Z"); // 6:19 PM
    expect(candidates[0].include).toBe(false);
    expect(candidates[1].include).toBe(true);
  });

  it("ignores the LAST MATCH date Gemini returns and uses only the time", () => {
    // "72 pts 29.09.2026" is when they last played, not the match date.
    const raw = {
      matches: [
        { player1: "Neterda R.", player2: "Ruzicka J.", competition: "TT CUP", timeText: "9:35 PM", dateText: "29.09.2026", ouStats: "17/14", ouHitRate: 55, edge: 10 },
        { player1: "A", player2: "B", timeText: "29.09.2026 10:15 PM" },
      ],
    };
    const { candidates, startsAt } = scan(raw, "2026-10-01T08:19:00Z"); // 6:19 PM Thu 1 Oct
    expect(startsAt(0)).toBe("2026-10-01T11:35:00.000Z"); // 9:35 PM Thu 1/10/2026
    expect(startsAt(1)).toBe("2026-10-01T12:15:00.000Z"); // 10:15 PM Thu 1/10/2026
    expect(candidates[0].timeStatus).toBe("resolved");
    expect(candidates[0].include).toBe(true);
    expect(candidates[0].timeNotes.join(" ")).toMatch(/Ignored "29\.09\.2026"/);
  });

  it("12 AM onwards is the next day even when the screenshot is sent in the morning", () => {
    const { startsAt } = scan(rows(["12:30 AM"]), "2026-10-01T00:00:00Z"); // 10:00 AM Thu 1 Oct
    expect(startsAt(0)).toBe("2026-10-01T14:30:00.000Z"); // 12:30 AM Fri 2/10/2026
  });

  it("asks for confirmation when the today rule is switched off", () => {
    const { candidates, startsAt } = scan(fixture, "2026-10-01T07:30:00Z", { ...settings, screenshotsAreToday: false });
    expect(candidates.every((c) => c.timeStatus === "needs_confirmation")).toBe(true);
    expect(startsAt(7)).toBe("2026-10-01T14:30:00.000Z");
  });
});
