import { describe, expect, it } from "vitest";
import { isCaptureCorroborated, parseZone, resolveMatchTime, type ResolveInput } from "@/lib/time/resolve";

// Screenshot captured 21 Sep 2026 17:30 Prague time (CEST, UTC+2).
const base: Omit<ResolveInput, "timeText"> = {
  capturedAt: "2026-09-21T15:30:00Z",
  captureSource: "EXIF",
  timezone: "Europe/Prague",
  timezoneConfirmed: true,
  now: new Date("2026-09-21T15:31:00Z"),
};

const resolve = (timeText: string | null, extra: Partial<ResolveInput> = {}) => resolveMatchTime({ ...base, timeText, ...extra });

describe("resolveMatchTime - required formats", () => {
  it('resolves "Today at 6:00 PM" against the capture date', () => {
    const r = resolve("Today at 6:00 PM");
    expect(r.status).toBe("resolved");
    expect(r.kind).toBe("relative-day");
    expect(r.startsAt).toBe("2026-09-21T16:00:00Z");
  });

  it('resolves "Tomorrow at 10:30 AM"', () => {
    const r = resolve("Tomorrow at 10:30 AM");
    expect(r.status).toBe("resolved");
    expect(r.startsAt).toBe("2026-09-22T08:30:00Z");
  });

  it('resolves "21/09/2026 at 15:00" as an absolute date (unambiguous day > 12)', () => {
    const r = resolve("21/09/2026 at 19:00");
    expect(r.status).toBe("resolved");
    expect(r.kind).toBe("absolute");
    expect(r.startsAt).toBe("2026-09-21T17:00:00Z");
  });

  it('resolves "Starts in 45 minutes" relative to the capture time', () => {
    const r = resolve("Starts in 45 minutes");
    expect(r.status).toBe("resolved");
    expect(r.kind).toBe("relative-duration");
    expect(r.startsAt).toBe("2026-09-21T16:15:00Z");
  });

  it("supports hours and minutes in relative durations", () => {
    expect(resolve("in 1h 20m").startsAt).toBe("2026-09-21T16:50:00Z");
    expect(resolve("Starts in 2 hours").startsAt).toBe("2026-09-21T17:30:00Z");
  });

  it("handles 24h clock with dot separator", () => {
    expect(resolve("Today 18.30").startsAt).toBe("2026-09-21T16:30:00Z");
  });

  it("handles ISO and month-name dates", () => {
    expect(resolve("2026-09-22 08:15").startsAt).toBe("2026-09-22T06:15:00Z");
    expect(resolve("Sep 22, 2026 7pm").startsAt).toBe("2026-09-22T17:00:00Z");
    expect(resolve("22 September 2026 19:00").startsAt).toBe("2026-09-22T17:00:00Z");
  });

  it("combines separate date header and time text", () => {
    const r = resolveMatchTime({ ...base, dateText: "Tomorrow", timeText: "19:45" });
    expect(r.startsAt).toBe("2026-09-22T17:45:00Z");
    expect(r.status).toBe("resolved");
  });
});

describe("resolveMatchTime - never guesses", () => {
  it("returns missing when there is no time text", () => {
    const r = resolve(null);
    expect(r.status).toBe("missing");
    expect(r.startsAt).toBeNull();
  });

  it("does not resolve relative times without a capture time", () => {
    const r = resolve("Today at 6:00 PM", { capturedAt: null, captureSource: "NONE" });
    expect(r.startsAt).toBeNull();
    expect(r.status).toBe("needs_confirmation");
    expect(r.issues[0]).toMatch(/capture time is unknown/i);

    const r2 = resolve("Starts in 45 minutes", { capturedAt: null, captureSource: "NONE" });
    expect(r2.startsAt).toBeNull();
    expect(r2.status).toBe("needs_confirmation");
  });

  it("flags capture times that only come from the file's modified date", () => {
    const r = resolve("Today at 6:00 PM", { captureSource: "FILE_MODIFIED" });
    expect(r.startsAt).toBe("2026-09-21T16:00:00Z");
    expect(r.status).toBe("needs_confirmation");
    expect(r.issues.join(" ")).toMatch(/modified date/);
  });

  it("accepts FILE_MODIFIED capture time when corroborated by the visible clock", () => {
    const r = resolve("Today at 6:00 PM", { captureSource: "FILE_MODIFIED", captureCorroborated: true });
    expect(r.status).toBe("resolved");
  });

  it("asks for confirmation when the timezone is not confirmed", () => {
    const r = resolve("Today at 6:00 PM", { timezoneConfirmed: false });
    expect(r.status).toBe("needs_confirmation");
    expect(r.issues.join(" ")).toMatch(/timezone/i);
  });

  it("does not need a confirmed timezone for pure durations", () => {
    const r = resolve("Starts in 45 minutes", { timezoneConfirmed: false });
    expect(r.status).toBe("resolved");
  });

  it("flags ambiguous numeric dates and reports the alternative", () => {
    const r = resolve("03/10/2026 15:00");
    expect(r.status).toBe("needs_confirmation");
    expect(r.startsAt).toBe("2026-10-03T13:00:00Z"); // DMY default
    expect(r.issues[0]).toMatch(/Ambiguous/);
    const mdy = resolve("03/10/2026 15:00", { dateOrder: "MDY" });
    expect(mdy.startsAt).toBe("2026-03-10T14:00:00Z");
  });

  it("flags a time without a date", () => {
    const r = resolve("18:00");
    expect(r.status).toBe("needs_confirmation");
    expect(r.kind).toBe("time-only");
    expect(r.startsAt).toBe("2026-09-21T16:00:00Z");
  });

  it("returns missing for a date without a time", () => {
    const r = resolve("21 Sep");
    expect(r.status).toBe("missing");
    expect(r.startsAt).toBeNull();
  });

  it("flags live matches", () => {
    expect(resolve("LIVE").startsAt).toBeNull();
    expect(resolve("LIVE").status).toBe("needs_confirmation");
  });

  it("flags times in the past", () => {
    const r = resolve("Today at 9:00 AM");
    expect(r.status).toBe("needs_confirmation");
    expect(r.issues.join(" ")).toMatch(/past/);
  });

  it("rejects impossible times", () => {
    expect(resolve("Today at 25:00").startsAt).toBeNull();
    expect(resolve("Today at 13:00 PM").startsAt).toBeNull();
  });
});

describe("resolveMatchTime - timezones", () => {
  it("uses a timezone printed next to the time", () => {
    const r = resolve("Today 18:00 CET");
    expect(r.startsAt).toBe("2026-09-21T17:00:00Z");
    expect(r.notes.join(" ")).toMatch(/CET/);
  });

  it("uses UTC offsets", () => {
    expect(resolve("Today 18:00 UTC+3").startsAt).toBe("2026-09-21T15:00:00Z");
    expect(resolve("Today 18:00 GMT").startsAt).toBe("2026-09-21T18:00:00Z");
  });

  it("uses the screenshot-level timezone label", () => {
    const r = resolve("Today at 6:00 PM", { screenshotTimezone: "UTC+0", timezoneConfirmed: false });
    expect(r.startsAt).toBe("2026-09-21T18:00:00Z");
    expect(r.status).toBe("resolved");
  });

  it("interprets Today in the user's timezone near midnight", () => {
    // 23:30 on 21 Sep in New York is already 22 Sep in UTC.
    const r = resolveMatchTime({
      timeText: "Tomorrow 9:00 AM",
      capturedAt: "2026-09-22T03:30:00Z",
      captureSource: "EXIF",
      timezone: "America/New_York",
      timezoneConfirmed: true,
      now: new Date("2026-09-22T03:31:00Z"),
    });
    expect(r.startsAt).toBe("2026-09-22T13:00:00Z");
  });

  it("handles daylight-saving changes", () => {
    // Europe/Prague switches from CEST to CET on 25 Oct 2026.
    const r = resolveMatchTime({
      timeText: "Tomorrow at 10:00",
      capturedAt: "2026-10-24T10:00:00Z",
      captureSource: "MANUAL",
      timezone: "Europe/Prague",
      timezoneConfirmed: true,
      now: new Date("2026-10-24T10:00:00Z"),
    });
    expect(r.startsAt).toBe("2026-10-25T09:00:00Z");
  });

  it("parses zone labels", () => {
    expect(parseZone("Europe/London")?.name).toBe("Europe/London");
    expect(parseZone("CEST")?.name).toBe("UTC+2");
    expect(parseZone("GMT-05:30")?.name).toBe("UTC-5:30");
    expect(parseZone("nonsense")).toBeNull();
  });
});

describe("isCaptureCorroborated", () => {
  it("matches a 24h status bar clock", () => {
    expect(isCaptureCorroborated("2026-09-21T15:30:00Z", "17:31", "Europe/Prague")).toBe(true);
    expect(isCaptureCorroborated("2026-09-21T15:30:00Z", "17:50", "Europe/Prague")).toBe(false);
  });
  it("matches a 12h clock without AM/PM", () => {
    expect(isCaptureCorroborated("2026-09-21T15:30:00Z", "5:30", "Europe/Prague")).toBe(true);
  });
  it("is false without data", () => {
    expect(isCaptureCorroborated(null, "17:30", "Europe/Prague")).toBe(false);
    expect(isCaptureCorroborated("2026-09-21T15:30:00Z", null, "Europe/Prague")).toBe(false);
  });
});
