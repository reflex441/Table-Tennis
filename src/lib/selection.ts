/** The picks a match can have. Client-safe. */
export const SELECTIONS = ["OVER", "UNDER", "SWEEP", "POINTS_SPREAD", "SET_SPREAD", "ML"] as const;
export type Selection = (typeof SELECTIONS)[number];

export function isSelection(v: unknown): v is Selection {
  return typeof v === "string" && (SELECTIONS as readonly string[]).includes(v);
}

export const SELECTION_LABEL: Record<Selection, string> = {
  OVER: "Over",
  UNDER: "Under",
  SWEEP: "Sweep",
  POINTS_SPREAD: "Points spread",
  SET_SPREAD: "Set spread",
  ML: "ML",
};

/** Bot plays are Over / Under picks only: a sweep, spread or ML is always your own pick, a personal play. */
export function canBeBot(s: Selection | null | undefined): boolean {
  return !s || s === "OVER" || s === "UNDER";
}

export const BOT_IS_OVER_UNDER = "Sweeps, spreads and ML are personal plays - bot plays are Over / Under only";

/** The play type a pick can have: "BOT" on a sweep or spread becomes "PERSONAL". */
export function playTypeFor(s: Selection | null | undefined, playType: "BOT" | "PERSONAL"): "BOT" | "PERSONAL" {
  return playType === "BOT" && !canBeBot(s) ? "PERSONAL" : playType;
}

/** The pick cards always on the Profit page (the others show once you have a bet on one). */
export function isMainPick(s: Selection): boolean {
  return s === "OVER" || s === "UNDER" || s === "SWEEP";
}

/** Handicap picks: their line is a spread ("-4.5", "+1.5"), not a points total. */
export function isSpread(s: Selection | null | undefined): boolean {
  return s === "POINTS_SPREAD" || s === "SET_SPREAD";
}

/** "POINTS_SPREAD" -> "POINTS SPREAD", as shown on badges and in pick lists. */
export function selectionName(s: Selection): string {
  return s.replace("_", " ");
}

/** "OVER 73.5", "POINTS SPREAD -4.5", "SET SPREAD +1.5", "SWEEP". */
export function pickText(s: Selection, line: number | null | undefined): string {
  if (line === null || line === undefined) return selectionName(s);
  return `${selectionName(s)} ${isSpread(s) && line > 0 ? "+" : ""}${line}`;
}

/**
 * Personal plays have no pick badge: pick from the O/U hit rate (over 50% =
 * OVER, under 50% = UNDER). Falls back to the O/U record ("28/22") when the
 * percentage is missing; exactly 50% (or no stats) leaves it unpicked.
 */
export function personalPick(ouHitRate: number | null, ouStats: string | null): Selection | null {
  let rate = ouHitRate;
  if (rate === null && ouStats) {
    const [a, b] = ouStats.split("/").map(Number);
    if (Number.isFinite(a) && Number.isFinite(b) && a + b > 0) rate = (a / (a + b)) * 100;
  }
  if (rate === null || rate === 50) return null;
  return rate > 50 ? "OVER" : "UNDER";
}
