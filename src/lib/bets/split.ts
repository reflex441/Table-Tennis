import { round2 } from "./profit";
import { SELECTIONS, type Selection } from "@/lib/selection";

/**
 * Split bets: one play bet on 2-3 picks, e.g. 0.5u UNDER + 0.5u SWEEP.
 * Helpers for the editors (client-safe).
 */

/** A pick as typed in an editor (strings straight from the inputs). */
export type LegDraft = { selection: Selection; stake: string; odds: string };

/** Second pick suggested when a bet is split: Sweep, or Under if the first pick is Sweep. */
function otherPick(first: Selection): Selection {
  return first === "SWEEP" ? "UNDER" : "SWEEP";
}

/** Splits a stake over picks, e.g. 1u -> 0.5u + 0.5u. */
export function splitLegs(total: number, first: Selection, firstOdds: string, count = 2): LegDraft[] {
  const each = round2(total / count);
  const picks = [first, otherPick(first), ...SELECTIONS.filter((s) => s !== first && s !== otherPick(first))].slice(0, count);
  return picks.map((selection, i) => ({ selection, stake: String(each), odds: i === 0 ? firstOdds : "" }));
}

/** Validates picks typed in a split-bet editor; returns an error message or the picks. */
export function parseLegs(legs: LegDraft[], opts: { requireOdds?: boolean } = {}): string | { selection: Selection; stake: number; odds: number | null }[] {
  const out = [];
  for (const [i, l] of legs.entries()) {
    const stake = Number(l.stake);
    const odds = l.odds.trim() ? Number(l.odds) : null;
    if (!Number.isFinite(stake) || stake <= 0) return `Pick ${i + 1}: stake must be a number of units above 0.`;
    if (odds === null && opts.requireOdds) return `Pick ${i + 1}: enter the odds you got.`;
    if (odds !== null && (!Number.isFinite(odds) || odds <= 1)) return `Pick ${i + 1}: odds must be decimal odds above 1.00 (e.g. 1.85).`;
    out.push({ selection: l.selection, stake: round2(stake), odds });
  }
  return out;
}
