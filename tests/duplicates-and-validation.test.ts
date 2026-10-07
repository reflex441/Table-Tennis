import { describe, expect, it } from "vitest";
import { compareNames, comparePlayers, matchDedupeKey, mergeRecords, normalizeName, playersKey, suggestMerges } from "@/lib/matching/dedupe";
import { createMatchesSchema, matchInputSchema, pastBetSchema, updateMatchSchema } from "@/lib/validation/match";
import { shortPlayerName } from "@/lib/matching/player-names";
import { settingsUpdateSchema } from "@/lib/validation/settings";
import { ALARM_SOUNDS } from "@/lib/alarm-sounds";
import { volumeToGain } from "@/lib/siren";
import { maskKey } from "@/lib/settings";
import { candidateFromExtraction, candidateToPayload, mergeCandidates, validateCandidate, type ScreenshotContext } from "@/lib/review/candidate";
import type { SettingsDTO } from "@/lib/validation/settings";
import type { ExtractedMatch } from "@/lib/gemini/types";
import { detectImageType } from "@/lib/screenshots";
import { createSessionToken, verifySessionToken } from "@/lib/auth/session";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { registerSchema, safeNext, updateProfileSchema } from "@/lib/validation/auth";
import { rateLimited } from "@/lib/auth/rate-limit";
import { googleConfigured, looksLikeGoogleClientId } from "@/lib/auth/google";

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
  stakeUnits: null,
  confidence: null,
  ...over,
});

describe("alarm sound settings", () => {
  it("accepts a volume of 1-100 and a known sound", () => {
    expect(settingsUpdateSchema.parse({ alarmVolume: 15, alarmSound: "chime" })).toEqual({ alarmVolume: 15, alarmSound: "chime" });
    expect(settingsUpdateSchema.safeParse({ alarmVolume: 0 }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ alarmVolume: 101 }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ alarmSound: "airhorn" }).success).toBe(false);
    expect(ALARM_SOUNDS).toEqual(["siren", "classic", "chime", "pulse", "rising"]);
    expect(volumeToGain(100)).toBeCloseTo(0.4);
    expect(volumeToGain(15)).toBeCloseTo(0.06); // the default is far quieter than the old siren (0.4)
  });
});

describe("Gemini model settings", () => {
  it("accepts model names and cleans them", () => {
    expect(settingsUpdateSchema.parse({ geminiModel: " models/gemini-3.5-flash-lite " })).toEqual({ geminiModel: "gemini-3.5-flash-lite" });
    expect(settingsUpdateSchema.parse({ geminiFallbackModel: "gemini-3.8-flash, models/gemini-3.5-flash" })).toEqual({ geminiFallbackModel: "gemini-3.8-flash,gemini-3.5-flash" });
    expect(settingsUpdateSchema.parse({ geminiFallbackModel: "" })).toEqual({ geminiFallbackModel: "" });
    expect(settingsUpdateSchema.safeParse({ geminiModel: "" }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ geminiModel: "gemini 3.5 flash" }).success).toBe(false);
  });
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

  it("signs and verifies session tokens for a user", () => {
    const secret = "test-secret-0123456789";
    const token = createSessionToken("cmuser123", secret, Date.now());
    expect(verifySessionToken(token, secret)).toBe("cmuser123");
    expect(verifySessionToken(token.slice(0, -2) + "xx", secret)).toBeNull();
    expect(verifySessionToken(token, "another-secret-0123456789")).toBeNull();
    // Changing the user id breaks the signature.
    expect(verifySessionToken(token.replace("cmuser123", "cmuser999"), secret)).toBeNull();
    expect(verifySessionToken(createSessionToken("cmuser123", secret, Date.now() - 40 * 86_400_000), secret)).toBeNull();
    expect(verifySessionToken(undefined, secret)).toBeNull();
    expect(verifySessionToken(token, "")).toBeNull();
  });

  it("hashes passwords with scrypt and checks them", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(hash).not.toContain("correct horse");
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("wrong password", hash)).toBe(false);
    expect(await verifyPassword("anything", null)).toBe(false);
    expect(await hashPassword("same")).not.toBe(await hashPassword("same")); // salted
  });

  it("validates sign-up input and post-login redirects", () => {
    expect(registerSchema.safeParse({ name: "Will", email: "will@example.com", password: "longenough" }).success).toBe(true);
    expect(registerSchema.safeParse({ name: "Will", email: "not-an-email", password: "longenough" }).success).toBe(false);
    expect(registerSchema.safeParse({ name: "Will", email: "will@example.com", password: "short" }).success).toBe(false);
    expect(registerSchema.safeParse({ name: "", email: "will@example.com", password: "longenough" }).success).toBe(false);
    expect(updateProfileSchema.parse({ name: "  New Name " })).toEqual({ name: "New Name" });
    expect(updateProfileSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ name: "x".repeat(41) }).success).toBe(false);
    expect(safeNext("/profit")).toBe("/profit");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });

  it("only turns on Google sign-in with real-looking credentials", () => {
    expect(looksLikeGoogleClientId("123456789012-abc123def456ghi789.apps.googleusercontent.com")).toBe(true);
    expect(looksLikeGoogleClientId("PASTE-YOUR-CLIENT-ID.apps.googleusercontent.com")).toBe(false);
    expect(looksLikeGoogleClientId("my-project-123")).toBe(false);
    const saved = { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET };
    try {
      process.env.GOOGLE_CLIENT_ID = "PASTE-YOUR-CLIENT-ID.apps.googleusercontent.com";
      process.env.GOOGLE_CLIENT_SECRET = "PASTE-YOUR-CLIENT-SECRET";
      expect(googleConfigured()).toBe(false);
      process.env.GOOGLE_CLIENT_ID = " 123456789012-abc123def456ghi789.apps.googleusercontent.com ";
      process.env.GOOGLE_CLIENT_SECRET = "GOCSPX-abcdefghijklmnop";
      expect(googleConfigured()).toBe(true);
    } finally {
      process.env.GOOGLE_CLIENT_ID = saved.id ?? "";
      process.env.GOOGLE_CLIENT_SECRET = saved.secret ?? "";
    }
  });

  it("rate-limits repeated attempts", () => {
    const key = `test-${Math.random()}`;
    const results = Array.from({ length: 6 }, (_, i) => rateLimited(key, 5, 60_000, 1_000 + i));
    expect(results).toEqual([false, false, false, false, false, true]);
    expect(rateLimited(key, 5, 60_000, 1_000 + 120_000)).toBe(false); // window passed
  });
});

describe("player names are stored as 'Surname F.'", () => {
  it("shortens full names and leaves short ones", () => {
    expect(shortPlayerName("Mariusz Koczyba")).toBe("Koczyba M.");
    expect(shortPlayerName("  Grzegorz   Jurowicz ")).toBe("Jurowicz G.");
    expect(shortPlayerName("Sobel A.")).toBe("Sobel A.");
    expect(shortPlayerName("Sobel A")).toBe("Sobel A.");
    expect(shortPlayerName("A. Sobel")).toBe("Sobel A.");
    expect(shortPlayerName("KOCZYBA Mariusz")).toBe("Koczyba M.");
    expect(shortPlayerName("mariusz koczyba")).toBe("Koczyba M.");
    expect(shortPlayerName("Jose Maria Garcia")).toBe("Garcia J.");
    expect(shortPlayerName("Tom van der Berg")).toBe("van der Berg T.");
    expect(shortPlayerName("Kim J.H.")).toBe("Kim J.H.");
    expect(shortPlayerName("Solo")).toBe("Solo");
  });

  it("applies to matches and past bets as they're saved", () => {
    const past = pastBetSchema.parse({ player1: "Mariusz Koczyba", player2: "Grzegorz Jurowicz", startsAt: "2026-10-06T19:40:00Z", timezone: "UTC", playType: "BOT", stake: 1, odds: 1.8, result: "WON" });
    expect([past.player1, past.player2]).toEqual(["Koczyba M.", "Jurowicz G."]);
  });
});

