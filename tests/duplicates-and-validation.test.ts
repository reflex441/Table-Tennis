import { describe, expect, it } from "vitest";
import { compareNames, comparePlayers, matchDedupeKey, mergeRecords, normalizeName, playersKey, suggestMerges } from "@/lib/matching/dedupe";
import { createMatchesSchema, matchInputSchema, updateMatchSchema } from "@/lib/validation/match";
import { SCAN_SPEED_THINKING, settingsUpdateSchema } from "@/lib/validation/settings";
import { maskKey } from "@/lib/settings";
import { candidateFromExtraction, candidateToPayload, mergeCandidates, validateCandidate, type ScreenshotContext } from "@/lib/review/candidate";
import type { SettingsDTO } from "@/lib/validation/settings";
import type { ExtractedMatch } from "@/lib/gemini/types";
import { detectImageType } from "@/lib/screenshots";
import { createSessionToken, verifySessionToken } from "@/lib/auth/session";

describe("duplicate detection", () => {
  it("normalises names (case, accents, punctuation)", () => {
    expect(normalizeName("  Varcl  J. ")).toBe("varcl j");
    expect(normalizeName("Šimon Ďurák")).toBe("simon durak");
  });

  it("builds order-insensitive keys", () => {
    expect(playersKey("Varcl J", "Jan S")).toBe(playersKey("jan s", "VARCL J."));
    const t = new Date("2026-09-21T16:00:30Z");
    expect(matchDedupeKey("Varcl J", "Jan S", t)).toBe(matchDedupeKey("Jan S", "Varcl J", new Date("2026-09-21T16:00:00Z")));
    expect(matchDedupeKey("Varcl J", "Jan S", t)).not.toBe(matchDedupeKey("Varcl J", "Jan S", new Date("2026-09-21T17:00:00Z")));
  });

  it("compares names", () => {
    expect(compareNames("Varcl J", "varcl j.")).toBe("same");
    expect(compareNames("Varcl J", "Jiri Varcl")).toBe("similar");
    expect(compareNames("Varcl J", "Novak P")).toBe("different");
    expect(compareNames(null, "Novak P")).toBe("different");
    expect(comparePlayers({ player1: "Varcl J", player2: "Jan S" }, { player1: "Jan S", player2: "Varcl J" })).toBe("same");
  });

  it("suggests merges only across different screenshots", () => {
    const suggestions = suggestMerges([
      { id: "a", sourceId: "shot1", player1: "Varcl J", player2: "Jan S" },
      { id: "b", sourceId: "shot2", player1: "Jan S", player2: "Varcl J" },
      { id: "c", sourceId: "shot2", player1: "Novak P", player2: "Kral M" },
      { id: "d", sourceId: "shot1", player1: "Varcl J", player2: "Jan S" },
    ]);
    expect(suggestions.map((s) => s.ids.join("+"))).toEqual(["a+b", "b+d"]);
  });

  it("does not suggest merging the same players at clearly different times", () => {
    const s = suggestMerges([
      { id: "a", sourceId: "1", player1: "Varcl J", player2: "Jan S", startsAt: "2026-09-21T16:00:00Z" },
      { id: "b", sourceId: "2", player1: "Varcl J", player2: "Jan S", startsAt: "2026-09-21T19:00:00Z" },
    ]);
    expect(s).toEqual([]);
  });

  it("merges records, filling gaps and reporting conflicts", () => {
    const { merged, conflicts } = mergeRecords(
      { player1: "Varcl J", competition: null, edge: 47, ouStats: null },
      { player1: "Varcl J", competition: "Czech Liga Pro", edge: 45, ouStats: "20/9" },
      ["player1", "competition", "edge", "ouStats"],
    );
    expect(merged).toEqual({ player1: "Varcl J", competition: "Czech Liga Pro", edge: 47, ouStats: "20/9" });
    expect(conflicts).toEqual([{ field: "edge", primary: 47, secondary: 45 }]);
  });
});

const settings: SettingsDTO = {
  defaultReminderMinutes: 5,
  timezone: "Europe/Prague",
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
  geminiKeySource: "none",
  geminiKeyHint: null,
};

const extracted = (over: Partial<ExtractedMatch>): ExtractedMatch => ({
  player1: null,
  player2: null,
  competition: null,
  timeText: null,
  dateText: null,
  selection: null,
  pointsLine: null,
  ouStats: null,
  ouHitRate: null,
  edge: null,
  confidence: null,
  ...over,
});

describe("review candidates", () => {
  const shotA: ScreenshotContext = { id: "A", capturedAt: "2026-09-21T15:30:00Z", capturedAtSource: "EXIF", visibleClock: null, timezoneText: null };
  const shotB: ScreenshotContext = { id: "B", capturedAt: null, capturedAtSource: "NONE", visibleClock: null, timezoneText: null };
  const now = new Date("2026-09-21T15:31:00Z");

  it("combines a schedule screenshot with a statistics screenshot after confirmation", () => {
    const schedule = candidateFromExtraction(extracted({ player1: "Varcl J", player2: "Jan S", competition: "Czech Liga Pro", timeText: "Today at 6:00 PM" }), shotA, settings, now);
    const stats = candidateFromExtraction(extracted({ player1: "Jan S", player2: "Varcl J", selection: "OVER", ouStats: "20/9", ouHitRate: 69, edge: 47 }), shotB, settings, now);
    expect(schedule.timeStatus).toBe("resolved");
    expect(stats.timeStatus).toBe("missing");

    const merged = mergeCandidates(schedule, stats);
    expect(merged).toMatchObject({ player1: "Varcl J", player2: "Jan S", selection: "OVER", ouStats: "20/9", ouHitRate: "69", edge: "47", competition: "Czech Liga Pro" });
    expect(merged.screenshotIds).toEqual(["A", "B"]);
    expect(merged.conflicts).toEqual([]);
    expect(validateCandidate(merged, settings.timezone, now).ok).toBe(true);

    const payload = candidateToPayload(merged, settings.timezone);
    expect(payload).toMatchObject({ startsAt: "2026-09-21T16:00:00.000Z", selection: "OVER", ouHitRate: 69, edge: 47, reminderMinutes: 5 });
    expect(matchInputSchema.safeParse(payload).success).toBe(true);
  });

  it("takes the time from the secondary candidate when the primary has none", () => {
    const stats = candidateFromExtraction(extracted({ player1: "Varcl J", player2: "Jan S", edge: 47 }), shotB, settings, now);
    const schedule = candidateFromExtraction(extracted({ player1: "Varcl J", player2: "Jan S", timeText: "Today at 6:00 PM" }), shotA, settings, now);
    const merged = mergeCandidates(stats, schedule);
    expect(merged.startsAtLocal).toBe("2026-09-21T18:00");
    expect(merged.timeSourceId).toBe("A");
  });

  it("requires players, a confirmed future time and valid statistics", () => {
    // With the "today's list" rule off, an ambiguous date still needs confirming.
    const c = candidateFromExtraction(extracted({ player1: "Varcl J", timeText: "03/10/2026 18:00", ouStats: "20-9-1", edge: 400 }), shotA, { ...settings, screenshotsAreToday: false }, now);
    const v = validateCandidate({ ...c, ouStats: "20-9-1", edge: "400" }, settings.timezone, now);
    expect(v.ok).toBe(false);
    expect(Object.keys(v.errors).sort()).toEqual(["edge", "ouStats", "player2", "time"]);
  });

  it("requires a start time when the screenshot has none", () => {
    const c = candidateFromExtraction(extracted({ player1: "A", player2: "B" }), shotA, settings, now);
    expect(validateCandidate(c, settings.timezone, now).errors.startsAt).toBe("Start time is required");
  });
});

describe("API validation schemas", () => {
  const valid = {
    player1: "Varcl J",
    player2: "Jan S",
    competition: "Czech Liga Pro",
    startsAt: "2026-09-21T16:00:00Z",
    timezone: "Europe/Prague",
    reminderMinutes: 5,
    selection: "OVER",
    ouStats: "20/9",
    ouHitRate: 69,
    edge: 47,
  };

  it("accepts a complete match", () => {
    const r = matchInputSchema.parse(valid);
    expect(r.screenshotIds).toEqual([]);
    expect(r.allowSimilar).toBe(false);
    expect(r.pointsLine).toBeNull();
  });

  it("rejects bad values", () => {
    for (const bad of [
      { player1: "" },
      { startsAt: "tomorrow" },
      { reminderMinutes: -1 },
      { reminderMinutes: 2.5 },
      { reminderMinutes: 2000 },
      { selection: "SIDEWAYS" },
      { ouStats: "20-9" },
      { ouHitRate: 101 },
      { edge: -101 },
    ]) {
      expect(matchInputSchema.safeParse({ ...valid, ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("requires at least one match in bulk creation", () => {
    expect(createMatchesSchema.safeParse({ matches: [] }).success).toBe(false);
  });

  it("leaves omitted fields undefined on update but allows clearing with null", () => {
    const r = updateMatchSchema.parse({ reminderMinutes: 10, edge: null });
    expect(r.reminderMinutes).toBe(10);
    expect(r.edge).toBeNull();
    expect(r.ouStats).toBeUndefined();
    expect(r.player1).toBeUndefined();
  });

  it("validates the Gemini API key setting", () => {
    expect(settingsUpdateSchema.safeParse({ geminiApiKey: "AIzaSyD-abcdefghijklmnopqrstuvwxyz12345" }).success).toBe(true);
    expect(settingsUpdateSchema.parse({ geminiApiKey: "  AIzaSyD-abcdefghijklmnopqrstuvwxyz12345 \n" }).geminiApiKey).toBe("AIzaSyD-abcdefghijklmnopqrstuvwxyz12345");
    expect(settingsUpdateSchema.safeParse({ geminiApiKey: null }).success).toBe(true);
    expect(settingsUpdateSchema.safeParse({ geminiApiKey: "short" }).success).toBe(false);
    // Copy/paste artefacts are cleaned up rather than rejected.
    expect(settingsUpdateSchema.parse({ geminiApiKey: "AIzaSyD-abcdefghij\u200Bklmnopqrstuvwxyz12345" }).geminiApiKey).toBe("AIzaSyD-abcdefghijklmnopqrstuvwxyz12345");
    expect(settingsUpdateSchema.parse({ geminiApiKey: "AIzaSyD-abcdefghij\nklmnopqrstuvwxyz12345" }).geminiApiKey).toBe("AIzaSyD-abcdefghijklmnopqrstuvwxyz12345");
    // Other Google key formats (e.g. containing '.') are accepted.
    expect(settingsUpdateSchema.safeParse({ geminiApiKey: "AQ.Ab8RN6LxYz-abc_DEF.ghijklmnopqrstuv" }).success).toBe(true);
    expect(settingsUpdateSchema.safeParse({ geminiApiKey: "AIzaSyD-abcdéfghijklmnopqrstuvwxyz12345" }).success).toBe(false);
    expect(maskKey("AIzaSyD-abcdefghijklmnopqrstuvwxyz12345")).toBe("…2345");
    expect(maskKey(null)).toBeNull();
  });

  it("validates the scan speed and maps it to a thinking level", () => {
    expect(settingsUpdateSchema.safeParse({ scanSpeed: "fastest" }).success).toBe(true);
    expect(settingsUpdateSchema.safeParse({ scanSpeed: "turbo" }).success).toBe(false);
    expect(SCAN_SPEED_THINKING).toEqual({ fastest: "MINIMAL", fast: "LOW", careful: "MEDIUM" });
  });

  it("validates settings", () => {
    expect(settingsUpdateSchema.safeParse({ timezone: "Europe/Prague", defaultReminderMinutes: 15 }).success).toBe(true);
    expect(settingsUpdateSchema.safeParse({ timezone: "Mars/Olympus" }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ dateOrder: "YMD" }).success).toBe(false);
  });
});

describe("uploads and auth helpers", () => {
  it("detects image types from magic bytes", () => {
    expect(detectImageType(Buffer.from("89504e470d0a1a0a0000000d", "hex"))).toBe("image/png");
    expect(detectImageType(Buffer.from("ffd8ffe000104a4649460001", "hex"))).toBe("image/jpeg");
    expect(detectImageType(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]))).toBe("image/webp");
    expect(detectImageType(Buffer.from("<svg onload=alert(1)>....."))).toBeNull();
  });

  it("signs and verifies session tokens", () => {
    process.env.SESSION_SECRET = "test-secret";
    const token = createSessionToken(Date.now());
    expect(verifySessionToken(token)).toBe(true);
    expect(verifySessionToken(token.slice(0, -2) + "xx")).toBe(false);
    expect(verifySessionToken(createSessionToken(Date.now() - 40 * 86_400_000))).toBe(false);
    expect(verifySessionToken(undefined)).toBe(false);
  });
});
