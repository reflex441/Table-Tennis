/** The picks a match can have. Client-safe. */
export const SELECTIONS = ["OVER", "UNDER", "SWEEP", "POINTS_SPREAD", "SET_SPREAD"] as const;
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
};

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
