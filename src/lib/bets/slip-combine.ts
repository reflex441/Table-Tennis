import type { Selection } from "@/lib/selection";
import type { BetResult } from "./profit";

/**
 * Several bets on the same pick of one match (e.g. Over 75.5 $250 @ 1.80 and
 * Over 74.5 $200 @ 1.73, both won) are counted as one bet: the stakes are
 * added up and the odds are what the total paid out, (450 + 346) / 450 =
 * 1.7689, so the profit is exactly what you got. Parts with different
 * results (one line won, the other lost) can't be one bet: they become a split
 * bet with one pick per result, which nets out the same way.
 */

/** One bet from a slip; stake in money, as on the slip. */
export interface SlipPart {
  stake: number;
  odds: number | null;
  result: BetResult;
  pointsLine: number | null;
}

interface CombinedLeg {
  stake: number;
  odds: number | null;
  result: BetResult;
}

interface CombinedSlip extends CombinedLeg {
  /** The line of the biggest part. */
  pointsLine: number | null;
  /** One per result when the parts' results differ (null: a single bet). */
  legs: CombinedLeg[] | null;
}

const RESULT_ORDER: BetResult[] = ["WON", "LOST", "VOID", "PENDING"];

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

interface SlipPick {
  selection: Selection | null;
  pointsLine: number | null;
  /** The selection as shown on the slip ("Mateusz Sikon"): which player, for the picks that have a side. */
  text?: string | null;
}

const side = (t: string | null | undefined) => (t ?? "").toLowerCase().replace(/[^a-z]/g, "");

/** Same pick on the same match: Over/Under with any line, other picks only on the same line and player (an ML on each player isn't one bet). */
export function sameSlipPick(a: SlipPick, b: SlipPick): boolean {
  if (!a.selection || a.selection !== b.selection) return false;
  if (a.selection === "OVER" || a.selection === "UNDER") return true;
  return a.pointsLine === b.pointsLine && (!a.text || !b.text || side(a.text) === side(b.text));
}

/** Total stake, and the odds the total paid out at (stake-weighted; null if any part has none). */
function merge(parts: SlipPart[], result: BetResult): CombinedLeg {
  const stake = parts.reduce((sum, p) => sum + p.stake, 0);
  const odds = parts.every((p) => p.odds !== null && p.odds > 1) ? round4(parts.reduce((sum, p) => sum + p.stake * p.odds!, 0) / stake) : null;
  return { stake: Math.round(stake * 100) / 100, odds, result };
}

export function combineSlipParts(parts: SlipPart[]): CombinedSlip {
  const biggest = parts.reduce((a, b) => (b.stake > a.stake ? b : a));
  const groups = RESULT_ORDER.flatMap((result) => {
    const same = parts.filter((p) => p.result === result);
    return same.length ? [merge(same, result)] : [];
  });
  if (groups.length === 1) return { ...groups[0], pointsLine: biggest.pointsLine, legs: null };
  // Mixed results: the net decides (as for any split bet).
  const all = merge(parts, "PENDING");
  const settled = groups.every((g) => g.result !== "PENDING");
  const net = groups.reduce((sum, g) => sum + (g.result === "WON" && g.odds ? g.stake * (g.odds - 1) : g.result === "LOST" ? -g.stake : 0), 0);
  const result: BetResult = !settled ? "PENDING" : net > 0 ? "WON" : net < 0 ? "LOST" : "VOID";
  return { stake: all.stake, odds: null, result, pointsLine: biggest.pointsLine, legs: groups };
}
