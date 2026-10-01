import type { ExtractedMatch, ExtractionResult } from "./types";

/**
 * Server-side validation of Gemini output. The model's JSON is treated as
 * untrusted: every field is checked individually, invalid values are
 * replaced by null (never "fixed" by guessing) and a warning is recorded.
 */

export class ExtractionFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionFormatError";
  }
}

const MAX_TEXT = 120;
const MAX_MATCHES = 50;

function cleanText(value: unknown, field: string, warnings: string[], max = MAX_TEXT): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    warnings.push(`${field}: expected text, got ${typeof value} - ignored.`);
    return null;
  }
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed || /^(null|n\/a|none|unknown|-+)$/i.test(trimmed)) return null;
  if (trimmed.length > max) {
    warnings.push(`${field}: value too long - ignored.`);
    return null;
  }
  return trimmed;
}

function cleanNumber(value: unknown, field: string, warnings: string[], min: number, max: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  let n: number;
  if (typeof value === "number") n = value;
  else if (typeof value === "string") {
    const stripped = value.replace(/[%\s]/g, "").replace(",", ".");
    if (!/^[+-]?\d+(\.\d+)?$/.test(stripped)) {
      warnings.push(`${field}: "${value}" is not a number - ignored.`);
      return null;
    }
    n = Number(stripped);
  } else {
    warnings.push(`${field}: expected a number - ignored.`);
    return null;
  }
  if (!Number.isFinite(n) || n < min || n > max) {
    warnings.push(`${field}: ${n} is outside the valid range ${min}..${max} - ignored.`);
    return null;
  }
  return Math.round(n * 100) / 100;
}

function cleanSelection(value: unknown, field: string, warnings: string[]): "OVER" | "UNDER" | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    warnings.push(`${field}: invalid selection - ignored.`);
    return null;
  }
  const v = value.trim().toUpperCase();
  if (v === "OVER" || v === "O") return "OVER";
  if (v === "UNDER" || v === "U") return "UNDER";
  if (!v || v === "NULL") return null;
  warnings.push(`${field}: "${value}" is not OVER or UNDER - ignored.`);
  return null;
}

function cleanOuStats(value: unknown, field: string, warnings: string[]): string | null {
  const text = cleanText(value, field, warnings, 20);
  if (text === null) return null;
  const m = text.match(/^(\d{1,4})\s*[/:-]\s*(\d{1,4})$/);
  if (!m) {
    warnings.push(`${field}: "${text}" is not in the form "20/9" - ignored.`);
    return null;
  }
  return `${Number(m[1])}/${Number(m[2])}`;
}

function normaliseMatch(raw: unknown, index: number, warnings: string[]): ExtractedMatch | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    warnings.push(`Match #${index + 1}: not an object - skipped.`);
    return null;
  }
  const r = raw as Record<string, unknown>;
  const p = `Match #${index + 1} `;
  const match: ExtractedMatch = {
    player1: cleanText(r.player1, `${p}player1`, warnings, 60),
    player2: cleanText(r.player2, `${p}player2`, warnings, 60),
    competition: cleanText(r.competition, `${p}competition`, warnings),
    timeText: cleanText(r.timeText, `${p}timeText`, warnings),
    dateText: cleanText(r.dateText, `${p}dateText`, warnings),
    selection: cleanSelection(r.selection, `${p}selection`, warnings),
    pointsLine: cleanNumber(r.pointsLine, `${p}pointsLine`, warnings, 0, 500),
    ouStats: cleanOuStats(r.ouStats, `${p}ouStats`, warnings),
    ouHitRate: cleanNumber(r.ouHitRate, `${p}ouHitRate`, warnings, 0, 100),
    edge: cleanNumber(r.edge, `${p}edge`, warnings, -100, 100),
    stakeUnits: cleanNumber(r.stakeUnits, `${p}stakeUnits`, warnings, 0, 100),
    confidence: cleanNumber(r.confidence, `${p}confidence`, warnings, 0, 1),
  };

  const meaningful = [
    match.player1, match.player2, match.competition, match.timeText, match.dateText,
    match.selection, match.pointsLine, match.ouStats, match.ouHitRate, match.edge,
  ].some((v) => v !== null);
  if (!meaningful) return null;

  if (match.player1 && match.player2 && match.player1.toLowerCase() === match.player2.toLowerCase()) {
    warnings.push(`${p}has the same name for both players - please check.`);
  }

  // Consistency check: does the O/U record agree with the percentage?
  if (match.ouStats && match.ouHitRate !== null) {
    const [a, b] = match.ouStats.split("/").map(Number);
    const total = a + b;
    if (total > 0) {
      const ra = (a / total) * 100;
      const rb = (b / total) * 100;
      if (Math.abs(ra - match.ouHitRate) > 2 && Math.abs(rb - match.ouHitRate) > 2) {
        warnings.push(`${p}O/U ${match.ouStats} does not match ${match.ouHitRate}% - please check.`);
      }
    }
  }
  // EDGE is the right-most bar value; equal to the O/U % usually means a misread.
  if (match.edge !== null && match.ouHitRate !== null && match.edge === match.ouHitRate) {
    warnings.push(`${p}EDGE ${match.edge}% is the same as the O/U % - check it is the right-most value (under the bar).`);
  }
  return match;
}

/** Parse the model's text response into JSON. */
export function parseModelJson(text: string | undefined | null): unknown {
  if (!text || !text.trim()) throw new ExtractionFormatError("Gemini returned an empty response.");
  let body = text.trim();
  // Tolerate fenced code blocks.
  const fence = body.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) body = fence[1];
  try {
    return JSON.parse(body);
  } catch {
    throw new ExtractionFormatError("Gemini returned invalid JSON.");
  }
}

export function normalizeExtraction(raw: unknown): { result: ExtractionResult; warnings: string[] } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ExtractionFormatError("Gemini response is not a JSON object.");
  }
  const r = raw as Record<string, unknown>;
  const warnings: string[] = [];
  if (r.matches !== undefined && r.matches !== null && !Array.isArray(r.matches)) {
    throw new ExtractionFormatError("Gemini response field 'matches' is not an array.");
  }
  const rawMatches = (r.matches as unknown[] | undefined) ?? [];
  if (rawMatches.length > MAX_MATCHES) warnings.push(`Only the first ${MAX_MATCHES} matches were kept.`);

  const matches = rawMatches
    .slice(0, MAX_MATCHES)
    .map((m, i) => normaliseMatch(m, i, warnings))
    .filter((m): m is ExtractedMatch => m !== null);

  return {
    result: {
      layout: cleanText(r.layout, "layout", warnings),
      visibleClock: cleanText(r.visibleClock, "visibleClock", warnings, 20),
      visibleDate: cleanText(r.visibleDate, "visibleDate", warnings, 40),
      timezoneText: cleanText(r.timezoneText, "timezoneText", warnings, 40),
      matches,
    },
    warnings,
  };
}
