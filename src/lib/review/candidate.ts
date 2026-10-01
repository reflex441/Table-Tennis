import type { ExtractedMatch } from "@/lib/gemini/types";
import { isCaptureCorroborated, resolveMatchTime, type CaptureSource, type ResolveStatus } from "@/lib/time/resolve";
import { mergeRecords } from "@/lib/matching/dedupe";
import { fromLocalInputValue, toLocalInputValue } from "@/lib/format";
import type { SettingsDTO } from "@/lib/validation/settings";

/**
 * A match detected in one or more screenshots, as edited in the review UI.
 * Statistic values are kept as strings so the inputs can be edited freely.
 */
export interface Candidate {
  id: string;
  /** Screenshot ids that contributed to this candidate. */
  screenshotIds: string[];
  /** Screenshot whose time text is used for time resolution. */
  timeSourceId: string | null;
  include: boolean;
  player1: string;
  player2: string;
  competition: string;
  timeText: string | null;
  dateText: string | null;
  /** datetime-local value in the user's timezone. */
  startsAtLocal: string;
  timeStatus: ResolveStatus | "manual";
  timeIssues: string[];
  timeNotes: string[];
  /** User ticked "time is correct" (or entered it manually). */
  timeConfirmed: boolean;
  selection: "" | "OVER" | "UNDER";
  pointsLine: string;
  ouStats: string;
  ouHitRate: string;
  edge: string;
  reminderMinutes: number;
  confidence: number | null;
  conflicts: { field: string; kept: string; other: string }[];
  allowSimilar: boolean;
  result: null | { status: "created" | "duplicate" | "similar" | "invalid" | "error"; message?: string; matchId?: string };
}

export interface ScreenshotContext {
  id: string;
  capturedAt: string | null;
  capturedAtSource: CaptureSource;
  visibleClock: string | null;
  timezoneText: string | null;
}

const numStr = (n: number | null) => (n === null || n === undefined ? "" : String(n));

let counter = 0;
export function newCandidateId(): string {
  counter += 1;
  return `c${Date.now().toString(36)}${counter}`;
}

export function candidateFromExtraction(m: ExtractedMatch, shot: ScreenshotContext, settings: SettingsDTO, now?: Date): Candidate {
  const c: Candidate = {
    id: newCandidateId(),
    screenshotIds: [shot.id],
    timeSourceId: shot.id,
    include: Boolean(m.player1 || m.player2),
    player1: m.player1 ?? "",
    player2: m.player2 ?? "",
    competition: m.competition ?? "",
    timeText: m.timeText,
    dateText: m.dateText,
    startsAtLocal: "",
    timeStatus: "missing",
    timeIssues: [],
    timeNotes: [],
    timeConfirmed: false,
    selection: m.selection ?? "",
    pointsLine: numStr(m.pointsLine),
    ouStats: m.ouStats ?? "",
    ouHitRate: numStr(m.ouHitRate),
    edge: numStr(m.edge),
    reminderMinutes: settings.defaultReminderMinutes,
    confidence: m.confidence,
    conflicts: [],
    allowSimilar: false,
    result: null,
  };
  const resolved = applyTimeResolution(c, shot, settings, now);
  // A match that has already started can't get a reminder: leave it unticked
  // so it doesn't block creating alarms for the rest of the screenshot.
  const iso = fromLocalInputValue(resolved.startsAtLocal, settings.timezone);
  if (iso && new Date(iso).getTime() <= (now ?? new Date()).getTime()) return { ...resolved, include: false };
  return resolved;
}

export function emptyCandidate(shotId: string | null, settings: SettingsDTO): Candidate {
  return {
    id: newCandidateId(),
    screenshotIds: shotId ? [shotId] : [],
    timeSourceId: null,
    include: true,
    player1: "",
    player2: "",
    competition: "",
    timeText: null,
    dateText: null,
    startsAtLocal: "",
    timeStatus: "missing",
    timeIssues: ["Enter the start time."],
    timeNotes: [],
    timeConfirmed: false,
    selection: "",
    pointsLine: "",
    ouStats: "",
    ouHitRate: "",
    edge: "",
    reminderMinutes: settings.defaultReminderMinutes,
    confidence: null,
    conflicts: [],
    allowSimilar: false,
    result: null,
  };
}

/** (Re)compute the proposed start time from the screenshot's time text. */
export function applyTimeResolution(c: Candidate, shot: ScreenshotContext | null, settings: SettingsDTO, now?: Date): Candidate {
  if (c.timeStatus === "manual") return c;
  const corroborated =
    shot?.capturedAtSource === "FILE_MODIFIED" && isCaptureCorroborated(shot.capturedAt, shot.visibleClock, settings.timezone);
  const r = resolveMatchTime({
    timeText: c.timeText,
    dateText: c.dateText,
    capturedAt: shot?.capturedAt ?? null,
    captureSource: shot?.capturedAtSource ?? "NONE",
    captureCorroborated: corroborated,
    timezone: settings.timezone,
    timezoneConfirmed: settings.timezoneConfirmed,
    screenshotTimezone: shot?.timezoneText ?? null,
    dateOrder: settings.dateOrder,
    now,
  });
  const notes = corroborated ? [...r.notes, "Capture time matches the clock visible in the screenshot."] : r.notes;
  return {
    ...c,
    startsAtLocal: r.startsAt ? toLocalInputValue(r.startsAt, settings.timezone) : "",
    timeStatus: r.status,
    timeIssues: r.issues,
    timeNotes: notes,
    timeConfirmed: r.status === "resolved",
  };
}

const MERGE_FIELDS = ["player1", "player2", "competition", "timeText", "dateText", "selection", "pointsLine", "ouStats", "ouHitRate", "edge"] as const;

/** Combine two candidates (user-confirmed). The primary's values win on conflict. */
export function mergeCandidates(primary: Candidate, secondary: Candidate): Candidate {
  const pick = (c: Candidate) => Object.fromEntries(MERGE_FIELDS.map((f) => [f, c[f] === "" ? null : c[f]])) as Record<string, unknown>;
  // Align player order so "A vs B" and "B vs A" merge cleanly.
  let sec = secondary;
  if (
    primary.player1 && secondary.player2 &&
    primary.player1.trim().toLowerCase() === secondary.player2.trim().toLowerCase()
  ) {
    sec = { ...secondary, player1: secondary.player2, player2: secondary.player1 };
  }
  const { merged, conflicts } = mergeRecords(pick(primary), pick(sec), [...MERGE_FIELDS]);
  const takeTimeFromSecondary = !primary.timeText && !primary.dateText && Boolean(sec.timeText || sec.dateText);
  const timeFromPrimary = primary.timeStatus === "manual" || !takeTimeFromSecondary;
  return {
    ...primary,
    player1: (merged.player1 as string | null) ?? "",
    player2: (merged.player2 as string | null) ?? "",
    competition: (merged.competition as string | null) ?? "",
    timeText: merged.timeText as string | null,
    dateText: merged.dateText as string | null,
    selection: ((merged.selection as string | null) ?? "") as Candidate["selection"],
    pointsLine: (merged.pointsLine as string | null) ?? "",
    ouStats: (merged.ouStats as string | null) ?? "",
    ouHitRate: (merged.ouHitRate as string | null) ?? "",
    edge: (merged.edge as string | null) ?? "",
    screenshotIds: Array.from(new Set([...primary.screenshotIds, ...secondary.screenshotIds])),
    timeSourceId: timeFromPrimary ? primary.timeSourceId : sec.timeSourceId,
    ...(timeFromPrimary
      ? {}
      : {
          startsAtLocal: sec.startsAtLocal,
          timeStatus: sec.timeStatus,
          timeIssues: sec.timeIssues,
          timeNotes: sec.timeNotes,
          timeConfirmed: sec.timeConfirmed,
        }),
    include: true,
    conflicts: [
      ...primary.conflicts,
      ...conflicts.map((c) => ({ field: c.field, kept: String(c.primary), other: String(c.secondary) })),
    ],
    result: null,
  };
}

export interface CandidateValidation {
  ok: boolean;
  errors: Partial<Record<"player1" | "player2" | "startsAt" | "time" | "ouStats" | "ouHitRate" | "edge" | "pointsLine", string>>;
}

function optNumber(s: string, min: number, max: number): number | null | "invalid" {
  if (!s.trim()) return null;
  const n = Number(s.replace(",", ".").replace("%", ""));
  if (!Number.isFinite(n) || n < min || n > max) return "invalid";
  return n;
}

export function validateCandidate(c: Candidate, timezone: string, now: Date = new Date()): CandidateValidation {
  const errors: CandidateValidation["errors"] = {};
  if (!c.player1.trim()) errors.player1 = "Player 1 is required";
  if (!c.player2.trim()) errors.player2 = "Player 2 is required";
  const iso = fromLocalInputValue(c.startsAtLocal, timezone);
  if (!iso) errors.startsAt = "Start time is required";
  else if (new Date(iso).getTime() <= now.getTime()) errors.startsAt = "Start time is in the past";
  if (iso && !c.timeConfirmed) errors.time = "Confirm the start time";
  if (c.ouStats.trim() && !/^\d{1,4}\/\d{1,4}$/.test(c.ouStats.trim())) errors.ouStats = 'Use the form "20/9"';
  if (optNumber(c.ouHitRate, 0, 100) === "invalid") errors.ouHitRate = "0-100";
  if (optNumber(c.edge, -100, 100) === "invalid") errors.edge = "-100..100";
  if (optNumber(c.pointsLine, 0, 500) === "invalid") errors.pointsLine = "Invalid";
  return { ok: Object.keys(errors).length === 0, errors };
}

/** Build the API payload for /api/matches. Call only after validateCandidate. */
export function candidateToPayload(c: Candidate, timezone: string) {
  const num = (s: string) => {
    const v = optNumber(s, -1000, 1000);
    return v === "invalid" ? null : v;
  };
  return {
    player1: c.player1.trim(),
    player2: c.player2.trim(),
    competition: c.competition.trim() || null,
    startsAt: fromLocalInputValue(c.startsAtLocal, timezone)!,
    timezone,
    rawTimeText: [c.dateText, c.timeText].filter(Boolean).join(" ") || null,
    reminderMinutes: c.reminderMinutes,
    screenshotIds: c.screenshotIds,
    allowSimilar: c.allowSimilar,
    selection: c.selection || null,
    pointsLine: num(c.pointsLine),
    ouStats: c.ouStats.trim() || null,
    ouHitRate: num(c.ouHitRate),
    edge: num(c.edge),
  };
}
