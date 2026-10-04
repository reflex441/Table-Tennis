/**
 * How often the two players have met before, from the O/U record: "11/3"
 * means 11 overs + 3 unders = 14 previous matchups. Client-safe.
 */

export const MATCHUP_BUCKETS = ["LT10", "10TO20", "GT20"] as const;
export type MatchupBucket = (typeof MATCHUP_BUCKETS)[number];

export const MATCHUP_LABEL: Record<MatchupBucket, string> = { LT10: "Under 10", "10TO20": "10–20", GT20: "Over 20" };
export const MATCHUP_HINT: Record<MatchupBucket, string> = { LT10: "0–9 matchups", "10TO20": "10 to 20 matchups", GT20: "21+ matchups" };

/** "11/3" -> 14; null when there's no O/U record. */
export function matchupCount(ouStats: string | null | undefined): number | null {
  const m = (ouStats ?? "").match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/);
  return m ? Number(m[1]) + Number(m[2]) : null;
}

/** Under 10, 10–20 (both included), over 20. */
export function matchupBucket(count: number | null): MatchupBucket | null {
  if (count === null) return null;
  return count < 10 ? "LT10" : count <= 20 ? "10TO20" : "GT20";
}
