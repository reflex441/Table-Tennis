/** The picks a match can have. Client-safe. */
export const SELECTIONS = ["OVER", "UNDER", "SWEEP"] as const;
export type Selection = (typeof SELECTIONS)[number];

export function isSelection(v: unknown): v is Selection {
  return typeof v === "string" && (SELECTIONS as readonly string[]).includes(v);
}

export const SELECTION_LABEL: Record<Selection, string> = { OVER: "Over", UNDER: "Under", SWEEP: "Sweep" };

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
