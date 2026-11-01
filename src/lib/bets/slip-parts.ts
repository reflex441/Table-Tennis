import { isSelection, type Selection } from "@/lib/selection";
import type { BetResult } from "./profit";

/**
 * The single bets from bet slips that make up a match's picks (stored on the
 * bet). With them, a new slip bet on a pick you already have (a second sweep,
 * a bigger Over) is combined into that pick, while the same slip bet scanned
 * again is recognised and not counted twice.
 */
export interface StoredPart {
  pick: Selection | null;
  /** Units. */
  stake: number;
  odds: number | null;
  result: BetResult;
}

const RESULTS: BetResult[] = ["PENDING", "WON", "LOST", "VOID"];

/** The stored parts (null when the bet has none: older bets, or edited by hand). */
export function readParts(json: unknown): StoredPart[] | null {
  if (!Array.isArray(json)) return null;
  const parts = json.flatMap((p): StoredPart[] => {
    if (!p || typeof p !== "object") return [];
    const { pick, stake, odds, result } = p as Record<string, unknown>;
    if (typeof stake !== "number" || !(stake > 0) || !RESULTS.includes(result as BetResult)) return [];
    return [{ pick: isSelection(pick) ? pick : null, stake, odds: typeof odds === "number" && odds > 1 ? odds : null, result: result as BetResult }];
  });
  return parts;
}

/**
 * The same bet from a slip: same stake and odds. The result can differ - a
 * bet scanned while still open and again once it settled is one bet.
 * `loose`: the stake was rounded to 0.01u (a pick saved before parts were kept).
 */
export function sameBet(a: { stake: number; odds: number | null }, b: { stake: number; odds: number | null }, loose = false): boolean {
  const odds = a.odds === null || b.odds === null ? a.odds === b.odds : Math.abs(a.odds - b.odds) < 1e-6;
  return odds && Math.abs(a.stake - b.stake) < (loose ? 0.0051 : 0.0001);
}

/**
 * Adds slip bets to the ones a pick is already made of: new ones are added,
 * ones it has already are skipped (an open one takes the result the slip now
 * shows). `changed` is false when there's nothing new: a duplicate.
 */
export function mergeParts<T extends Omit<StoredPart, "pick">>(known: T[], incoming: T[], loose = false): { parts: T[]; changed: boolean } {
  const parts = [...known];
  const used = new Set<number>();
  let changed = false;
  for (const p of incoming) {
    const i = parts.findIndex((k, j) => !used.has(j) && sameBet(k, p, loose));
    if (i < 0) {
      used.add(parts.push(p) - 1);
      changed = true;
      continue;
    }
    used.add(i);
    // The slip's exact stake and odds; a settled result stays (an older screenshot can show it open).
    const result = parts[i].result === "PENDING" ? p.result : parts[i].result;
    if (result !== parts[i].result) changed = true;
    parts[i] = { ...parts[i], stake: p.stake, odds: p.odds, result };
  }
  return { parts, changed };
}
