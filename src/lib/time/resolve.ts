import { DateTime, IANAZone, FixedOffsetZone, type Zone } from "luxon";

/**
 * Deterministic resolution of screenshot time text into a UTC instant.
 *
 * Gemini only transcribes what is visible ("Today at 6:00 PM"); all date
 * arithmetic happens here so it is testable and never invented by the model.
 * Anything that depends on an assumption is returned as
 * `needs_confirmation` so the user confirms it before an alarm is created.
 */

export type CaptureSource = "EXIF" | "FILE_MODIFIED" | "MANUAL" | "NONE";
export type DateOrder = "DMY" | "MDY";

export interface ResolveInput {
  /** Verbatim start time text, e.g. "Today at 6:00 PM" or "Starts in 45 minutes". */
  timeText: string | null | undefined;
  /** Optional separate date text shown elsewhere in the screenshot. */
  dateText?: string | null;
  /** Screenshot capture time (ISO string, UTC). */
  capturedAt: string | null | undefined;
  captureSource: CaptureSource;
  /**
   * True when a FILE_MODIFIED capture time was corroborated by the clock
   * visible in the screenshot's status bar.
   */
  captureCorroborated?: boolean;
  /** User's preferred IANA timezone. */
  timezone: string;
  timezoneConfirmed: boolean;
  /** Timezone text visible in the screenshot, e.g. "CET" or "UTC+2". */
  screenshotTimezone?: string | null;
  dateOrder?: DateOrder;
  /**
   * Ignore timezone labels read from the screenshot and always use
   * `timezone` (for sites that show times in the viewer's local time;
   * avoids mistakes when Gemini misreads a cropped header).
   */
  ignoreScreenshotTimezone?: boolean;
  /**
   * The screenshot is a list of today's matches: a bare time ("8:10 PM")
   * is on the capture date, or the next day once the list passes midnight.
   * Such times are then resolved without asking for confirmation.
   */
  assumeToday?: boolean;
  /**
   * Start of the previous row in the same screenshot (ISO). Rows are in
   * chronological order, so a bare time is placed at or after it.
   */
  notBefore?: string | null;
  /** Current time, injectable for tests. */
  now?: Date;
}

export type ResolveStatus = "resolved" | "needs_confirmation" | "missing";

export type ResolveKind =
  | "none"
  | "absolute"
  | "relative-day"
  | "relative-duration"
  | "weekday"
  | "time-only"
  | "date-only"
  | "live"
  | "unparsed";

export interface ResolveResult {
  /** Proposed start time (ISO, UTC) or null when it cannot be determined. */
  startsAt: string | null;
  status: ResolveStatus;
  kind: ResolveKind;
  /** IANA zone or fixed offset used for interpretation. */
  zone: string;
  /** Problems that require the user's attention. */
  issues: string[];
  /** Informational notes about how the value was interpreted. */
  notes: string[];
}

const ABBREVIATION_OFFSETS: Record<string, string> = {
  UTC: "UTC",
  GMT: "UTC",
  Z: "UTC",
  WET: "UTC+0",
  WEST: "UTC+1",
  BST: "UTC+1",
  CET: "UTC+1",
  CEST: "UTC+2",
  EET: "UTC+2",
  EEST: "UTC+3",
  MSK: "UTC+3",
  EST: "UTC-5",
  EDT: "UTC-4",
  PST: "UTC-8",
  PDT: "UTC-7",
  MST: "UTC-7",
  MDT: "UTC-6",
  JST: "UTC+9",
  AEST: "UTC+10",
  AEDT: "UTC+11",
};

/** A bare time is placed on the occurrence within ±12 h of the capture time. */
const HALF_DAY_MS = 12 * 60 * 60_000;

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const WEEKDAYS: Record<string, number> = {
  mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
  sun: 7, sunday: 7,
};

/** Parse a timezone label (IANA name, abbreviation or UTC±hh[:mm]) into a Luxon zone. */
export function parseZone(label: string | null | undefined): Zone | null {
  if (!label) return null;
  const trimmed = label.trim();
  if (!trimmed) return null;
  if (trimmed.includes("/") && IANAZone.isValidZone(trimmed)) return IANAZone.create(trimmed);
  const upper = trimmed.toUpperCase().replace(/\s+/g, "");
  if (ABBREVIATION_OFFSETS[upper]) return FixedOffsetZone.parseSpecifier(ABBREVIATION_OFFSETS[upper]);
  const m = upper.match(/^(?:UTC|GMT)([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (m) {
    const hours = Number(m[2]);
    const minutes = Number(m[3] ?? 0);
    if (hours > 14 || minutes > 59) return null;
    const total = (hours * 60 + minutes) * (m[1] === "-" ? -1 : 1);
    return FixedOffsetZone.instance(total);
  }
  return null;
}

/** Find a timezone token inside free text, e.g. "18:00 CET". */
function findZoneInText(text: string): { zone: Zone; label: string } | null {
  const offset = text.match(/\b(?:UTC|GMT)\s?[+-]\s?\d{1,2}(?::?\d{2})?\b/i);
  if (offset) {
    const zone = parseZone(offset[0].replace(/\s/g, ""));
    if (zone) return { zone, label: offset[0].replace(/\s/g, "").toUpperCase() };
  }
  const tokens = text.match(/\b[A-Za-z]{2,4}\b/g) ?? [];
  for (const token of tokens) {
    const upper = token.toUpperCase();
    // Only accept upper-case abbreviations in the source text to avoid
    // matching ordinary words.
    if (token === upper && ABBREVIATION_OFFSETS[upper] && upper !== "Z") {
      const zone = parseZone(upper);
      if (zone) return { zone, label: upper };
    }
  }
  return null;
}

interface ParsedTime {
  hour: number;
  minute: number;
  /** The substring that was recognised as the time. */
  match: string;
}

function parseTimeOfDay(text: string): ParsedTime | null | "invalid" {
  // 18:00, 6:00 PM, 6.30pm, 18h00
  let m = text.match(/\b(\d{1,2})\s*[:.h]\s*(\d{2})\s*(a\.?m\.?|p\.?m\.?)?(?![\d/.-])/i);
  if (!m) {
    // 6 PM, 6pm
    const m2 = text.match(/\b(\d{1,2})\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/i);
    if (m2) m = [m2[0], m2[1], "00", m2[2]] as unknown as RegExpMatchArray;
  }
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  const meridiem = m[3]?.toLowerCase().replace(/\./g, "");
  if (minute > 59) return "invalid";
  if (meridiem) {
    if (hour < 1 || hour > 12) return "invalid";
    if (meridiem === "am") hour = hour === 12 ? 0 : hour;
    else hour = hour === 12 ? 12 : hour + 12;
  } else if (hour > 23) {
    return "invalid";
  }
  return { hour, minute, match: m[0] };
}

interface ParsedDate {
  year: number | null;
  month: number;
  day: number;
  ambiguous: boolean;
  alternative?: { month: number; day: number };
}

function parseDate(text: string, order: DateOrder): ParsedDate | null | "invalid" {
  // ISO yyyy-mm-dd
  let m = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return validDate({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), ambiguous: false });

  // dd/mm/yyyy, dd.mm.yyyy, dd-mm-yyyy (also 2-digit years)
  m = text.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
  if (m) return numericDate(Number(m[1]), Number(m[2]), normaliseYear(m[3]), order);

  // dd/mm or dd.mm (no year). The time has already been removed from `text`.
  m = text.match(/\b(\d{1,2})[/.](\d{1,2})\b/);
  if (m) return numericDate(Number(m[1]), Number(m[2]), null, order);

  // 21 Sep 2026 / 21 September / 21st Sep
  m = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?(?:,?\s+(\d{4}))?\b/i);
  if (m && MONTHS[m[2].toLowerCase()]) {
    return validDate({ year: m[3] ? Number(m[3]) : null, month: MONTHS[m[2].toLowerCase()], day: Number(m[1]), ambiguous: false });
  }
  // Sep 21 2026 / September 21st, 2026
  m = text.match(/\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i);
  if (m && MONTHS[m[1].toLowerCase()]) {
    return validDate({ year: m[3] ? Number(m[3]) : null, month: MONTHS[m[1].toLowerCase()], day: Number(m[2]), ambiguous: false });
  }
  return null;
}

function normaliseYear(raw: string): number {
  const n = Number(raw);
  return raw.length === 2 ? 2000 + n : n;
}

function numericDate(a: number, b: number, year: number | null, order: DateOrder): ParsedDate | "invalid" {
  const dmy = { day: a, month: b };
  const mdy = { day: b, month: a };
  const dmyValid = isValidMonthDay(dmy.month, dmy.day);
  const mdyValid = isValidMonthDay(mdy.month, mdy.day);
  if (dmyValid && mdyValid && a !== b) {
    const preferred = order === "DMY" ? dmy : mdy;
    const alternative = order === "DMY" ? mdy : dmy;
    return { year, ...preferred, ambiguous: true, alternative };
  }
  if (dmyValid) return { year, ...dmy, ambiguous: false };
  if (mdyValid) return { year, ...mdy, ambiguous: false };
  return "invalid";
}

function isValidMonthDay(month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

function validDate(d: ParsedDate): ParsedDate | "invalid" {
  return isValidMonthDay(d.month, d.day) ? d : "invalid";
}

function parseRelativeDuration(text: string): number | null {
  // "starts in 45 minutes", "in 1h 20m", "in 2 hours", "in 45'", "45 min"
  const m = text.match(/\bin\s+(?:(\d{1,3})\s*(?:h|hr|hrs|hour|hours)\b)?\s*(?:(\d{1,4})\s*(?:m|min|mins|minute|minutes|')(?![a-z]))?/i);
  if (m && (m[1] || m[2])) {
    return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
  }
  const m2 = text.match(/^\s*(?:starts?\s+)?(?:in\s+)?(\d{1,4})\s*(?:min|mins|minutes)\b/i);
  if (m2) return Number(m2[1]);
  return null;
}

function emptyResult(zone: string, kind: ResolveKind, status: ResolveStatus, issues: string[], notes: string[] = []): ResolveResult {
  return { startsAt: null, status, kind, zone, issues, notes };
}

export function resolveMatchTime(input: ResolveInput): ResolveResult {
  const now = DateTime.fromJSDate(input.now ?? new Date());
  const order = input.dateOrder ?? "DMY";
  const rawText = [input.dateText, input.timeText].filter((s): s is string => Boolean(s && s.trim())).join(" ").trim();

  const issues: string[] = [];
  const notes: string[] = [];

  // ---- Zone -------------------------------------------------------------
  let zone: Zone | null = null;
  let zoneReliable = false;
  let textZone = rawText ? findZoneInText(rawText) : null;
  let screenshotZone = parseZone(input.screenshotTimezone);
  if (input.ignoreScreenshotTimezone && (textZone || screenshotZone)) {
    notes.push(`Timezone label "${textZone?.label ?? input.screenshotTimezone}" in the screenshot ignored - times are read as ${input.timezone}.`);
    textZone = null;
    screenshotZone = null;
  }
  if (textZone) {
    zone = textZone.zone;
    zoneReliable = true;
    notes.push(`Timezone ${textZone.label} shown in the screenshot.`);
  } else if (screenshotZone) {
    zone = screenshotZone;
    zoneReliable = true;
    notes.push(`Timezone ${input.screenshotTimezone} shown in the screenshot.`);
  } else {
    const preferred = IANAZone.isValidZone(input.timezone) ? IANAZone.create(input.timezone) : null;
    zone = preferred ?? FixedOffsetZone.utcInstance;
    zoneReliable = Boolean(preferred) && input.timezoneConfirmed;
    if (zoneReliable) notes.push(`Interpreted in your timezone (${zone.name}).`);
    else issues.push(`No timezone visible and your timezone is not confirmed in Settings - assumed ${zone.name}.`);
  }
  const zoneName = zone.name;

  if (!rawText) {
    return emptyResult(zoneName, "none", "missing", ["No start time found in the screenshot - enter it manually."]);
  }

  const lower = rawText.toLowerCase();

  // ---- Reference (capture) time -----------------------------------------
  const captured = input.capturedAt ? DateTime.fromISO(input.capturedAt, { zone: "utc" }) : null;
  const hasCapture = Boolean(captured && captured.isValid);
  const captureReliable =
    hasCapture && (input.captureSource === "EXIF" || input.captureSource === "MANUAL" || (input.captureSource === "FILE_MODIFIED" && Boolean(input.captureCorroborated)));
  const reference = hasCapture ? captured!.setZone(zone) : null;
  const referenceIssue = !hasCapture
    ? "The screenshot capture time is unknown, so relative times cannot be resolved. Enter the capture time or the start time."
    : captureReliable
      ? null
      : "Capture time was taken from the file's modified date - please confirm it.";

  // ---- Live / started ---------------------------------------------------
  if (/\b(live|in play|in-play|started|set \d|1st set|2nd set|finished|ended|ft)\b/.test(lower) && !/\bstarts? in\b/.test(lower)) {
    return emptyResult(zoneName, "live", "needs_confirmation", ["The screenshot suggests the match is live or finished - enter the start time manually."]);
  }

  // ---- Relative duration ("Starts in 45 minutes") -----------------------
  const durationMinutes = parseRelativeDuration(lower);
  if (durationMinutes !== null) {
    if (!reference) {
      return emptyResult(zoneName, "relative-duration", "needs_confirmation", [referenceIssue!], notes);
    }
    const startsAt = reference.plus({ minutes: durationMinutes });
    if (referenceIssue) issues.push(referenceIssue);
    notes.push(`${durationMinutes} minutes after the screenshot was captured (${reference.toFormat("dd LLL yyyy HH:mm")}).`);
    // Duration arithmetic is zone independent, so zone confidence is irrelevant.
    const zoneIssues = issues.filter((i) => !i.startsWith("No timezone visible"));
    return finalise(startsAt, "relative-duration", zoneName, zoneIssues, notes, now);
  }

  const timeOfDay = parseTimeOfDay(rawText);
  if (timeOfDay === "invalid") {
    return emptyResult(zoneName, "unparsed", "needs_confirmation", [`Could not understand the time "${rawText}".`], notes);
  }

  // ---- Explicit date (parsed with the time removed) ---------------------
  const dateSource = timeOfDay ? rawText.replace(timeOfDay.match, " ") : rawText;
  const date = parseDate(dateSource, order);
  if (date === "invalid") {
    return emptyResult(zoneName, "unparsed", "needs_confirmation", [`Could not understand the date in "${rawText}".`], notes);
  }

  // ---- Relative day ("Today", "Tomorrow") -------------------------------
  const dayWord = lower.match(/\b(today|tonight|tomorrow|tmrw|tmr|yesterday)\b/)?.[1] ?? null;
  const weekdayMatch = lower.match(/\b(mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/);

  if (!timeOfDay) {
    if (date || dayWord || weekdayMatch) {
      return emptyResult(zoneName, "date-only", "missing", ["The screenshot shows a date but no start time - enter the time manually."], notes);
    }
    return emptyResult(zoneName, "unparsed", "needs_confirmation", [`Could not find a time in "${rawText}".`], notes);
  }

  if (date) {
    let year = date.year;
    if (year === null) {
      const base = reference ?? now.setZone(zone);
      year = base.year;
      issues.push(`No year shown - assumed ${year}.`);
    }
    if (date.ambiguous && date.alternative) {
      issues.push(
        `Ambiguous date "${rawText}": interpreted as ${order === "DMY" ? "day/month" : "month/day"}. ` +
          `It could also be ${String(date.alternative.day).padStart(2, "0")} ${monthName(date.alternative.month)}.`,
      );
    }
    const dt = DateTime.fromObject({ year, month: date.month, day: date.day, hour: timeOfDay.hour, minute: timeOfDay.minute }, { zone });
    if (!dt.isValid) {
      return emptyResult(zoneName, "unparsed", "needs_confirmation", [`Invalid date/time "${rawText}".`], notes);
    }
    return finalise(dt, "absolute", zoneName, issues, notes, now);
  }

  if (dayWord) {
    if (!reference) {
      return emptyResult(zoneName, "relative-day", "needs_confirmation", [referenceIssue!], notes);
    }
    if (referenceIssue) issues.push(referenceIssue);
    const offsetDays = dayWord === "yesterday" ? -1 : dayWord.startsWith("t") && dayWord !== "today" && dayWord !== "tonight" ? 1 : 0;
    const day = reference.startOf("day").plus({ days: offsetDays });
    const dt = day.set({ hour: timeOfDay.hour, minute: timeOfDay.minute });
    notes.push(`"${capitalise(dayWord)}" relative to the capture date ${reference.toFormat("ccc dd LLL yyyy")}.`);
    return finalise(dt, "relative-day", zoneName, issues, notes, now);
  }

  if (weekdayMatch) {
    if (!reference) {
      return emptyResult(zoneName, "weekday", "needs_confirmation", [referenceIssue!], notes);
    }
    if (referenceIssue) issues.push(referenceIssue);
    const key = weekdayMatch[1].slice(0, 3);
    const target = WEEKDAYS[key];
    const base = reference.startOf("day");
    const delta = (target - base.weekday + 7) % 7;
    const dt = base.plus({ days: delta }).set({ hour: timeOfDay.hour, minute: timeOfDay.minute });
    issues.push(`Weekday "${weekdayMatch[1]}" assumed to be the next one on or after the capture date.`);
    return finalise(dt, "weekday", zoneName, issues, notes, now);
  }

  // Time only ("8:10 PM"). The first row is placed on the occurrence
  // closest to the capture time (so "12:15 AM" captured at 11:50 PM is the
  // next day); later rows are placed at or after the previous row, because
  // match lists are chronological and run past midnight.
  if (!reference) {
    return emptyResult(zoneName, "time-only", "needs_confirmation", ["Only a time is shown and the capture date is unknown - choose the date."], notes);
  }
  let dt = reference.startOf("day").set({ hour: timeOfDay.hour, minute: timeOfDay.minute });
  const floor = input.notBefore ? DateTime.fromISO(input.notBefore).setZone(zone) : null;
  if (floor && floor.isValid) {
    for (let i = 0; i < 3 && dt.toMillis() < floor.toMillis(); i++) dt = dt.plus({ days: 1 });
  } else if (reference.toMillis() - dt.toMillis() > HALF_DAY_MS) {
    dt = dt.plus({ days: 1 });
  } else if (dt.toMillis() - reference.toMillis() > HALF_DAY_MS) {
    dt = dt.minus({ days: 1 });
  }
  const sameDay = dt.hasSame(reference, "day");
  const dayText = dt.toFormat("ccc dd LLL");
  if (input.assumeToday) {
    notes.push(sameDay ? `Today's list - ${dayText}.` : `After midnight in today's list - ${dayText}.`);
  } else {
    if (referenceIssue) issues.push(referenceIssue);
    issues.push(
      sameDay
        ? `Only a time is shown - assumed the capture date ${dayText}.`
        : `Only a time is shown - assumed ${dayText} (the list runs past midnight / time had passed at capture).`,
    );
  }
  return finalise(dt, "time-only", zoneName, issues, notes, now);
}

function finalise(dt: DateTime, kind: ResolveKind, zone: string, issues: string[], notes: string[], now: DateTime): ResolveResult {
  if (!dt.isValid) {
    return emptyResult(zone, "unparsed", "needs_confirmation", ["Could not compute a valid time."], notes);
  }
  const allIssues = [...issues];
  if (dt.toMillis() <= now.toMillis()) {
    allIssues.push("This start time is in the past.");
  }
  return {
    startsAt: dt.toUTC().toISO({ suppressMilliseconds: true }),
    status: allIssues.length ? "needs_confirmation" : "resolved",
    kind,
    zone,
    issues: allIssues,
    notes,
  };
}

function monthName(month: number): string {
  return DateTime.fromObject({ year: 2000, month, day: 1 }).toFormat("LLL");
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Decide whether a FILE_MODIFIED capture time is corroborated by the clock
 * visible in the screenshot (e.g. the phone status bar shows "17:42").
 */
export function isCaptureCorroborated(capturedAt: string | null | undefined, visibleClock: string | null | undefined, timezone: string, toleranceMinutes = 3): boolean {
  if (!capturedAt || !visibleClock) return false;
  const parsed = parseTimeOfDay(visibleClock);
  if (!parsed || parsed === "invalid") return false;
  if (!IANAZone.isValidZone(timezone)) return false;
  const captured = DateTime.fromISO(capturedAt, { zone: "utc" }).setZone(timezone);
  if (!captured.isValid) return false;
  const capturedMinutes = captured.hour * 60 + captured.minute;
  const clockMinutes = parsed.hour * 60 + parsed.minute;
  // A 12-hour status bar clock ("5:42") may omit AM/PM.
  const candidates = /am|pm/i.test(visibleClock) || parsed.hour >= 13 || parsed.hour === 0
    ? [clockMinutes]
    : [clockMinutes, (clockMinutes + 12 * 60) % (24 * 60)];
  return candidates.some((c) => {
    const diff = Math.abs(c - capturedMinutes);
    return Math.min(diff, 24 * 60 - diff) <= toleranceMinutes;
  });
}
