import { normalizeName, playersKey } from "@/lib/matching/dedupe";
import { summarize, type ProfitSummary, type Settleable } from "./profit";

/**
 * Profit page: which players, and which two players meeting, make you the
 * most money. A bet counts for both players of its match (so the players'
 * totals add up to twice the total); a pair is the two players in either
 * order. Names are grouped however they're spelled ("Lewczuk M." /
 * "LEWCZUK M."), shown as last spelled. Client-safe.
 */

export type PlayerRow = Settleable & { player1: string; player2: string };

export interface PlayerStat {
  /** The normalized name, or the pair key (see playersKey). */
  key: string;
  label: string;
  summary: ProfitSummary;
}

export type PlayerSort = "profit" | "loss" | "roi" | "bets";

/** ROI of fewer settled bets than this says little: sorted after the rest. */
export const ROI_MIN_BETS = 3;

function group<T extends PlayerRow>(rows: T[], keysOf: (r: T) => { key: string; label: string }[]): PlayerStat[] {
  const groups = new Map<string, { label: string; rows: T[] }>();
  for (const r of rows) {
    for (const { key, label } of keysOf(r)) {
      if (!key) continue;
      const g = groups.get(key) ?? { label, rows: [] };
      g.rows.push(r);
      groups.set(key, g);
    }
  }
  return [...groups].map(([key, g]) => ({ key, label: g.label, summary: summarize(g.rows) }));
}

/** Rows latest first: the first spelling seen is the label. */
export function byPlayer<T extends PlayerRow>(rows: T[]): PlayerStat[] {
  return group(rows, (r) => {
    const a = normalizeName(r.player1);
    const b = normalizeName(r.player2);
    return a === b ? [{ key: a, label: r.player1 }] : [{ key: a, label: r.player1 }, { key: b, label: r.player2 }];
  });
}

export function byPair<T extends PlayerRow>(rows: T[]): PlayerStat[] {
  return group(rows, (r) => [{ key: playersKey(r.player1, r.player2), label: `${r.player1} vs ${r.player2}` }]);
}

/** The bet is on this player's match (`kind` player) or between this pair. */
export function rowIsFor(r: { player1: string; player2: string }, kind: "player" | "pair", key: string): boolean {
  return kind === "pair" ? playersKey(r.player1, r.player2) === key : normalizeName(r.player1) === key || normalizeName(r.player2) === key;
}

/**
 * Only players with settled bets, sorted: most / least profit, best ROI
 * (players with fewer than ROI_MIN_BETS settled bets after the rest), or most
 * bets. Ties go to more bets, then the name.
 */
export function sortStats(stats: PlayerStat[], sort: PlayerSort): PlayerStat[] {
  const value = (s: PlayerStat) => {
    switch (sort) {
      case "loss":
        return -s.summary.profit;
      case "roi":
        return s.summary.roi ?? -Infinity;
      case "bets":
        return s.summary.bets;
      default:
        return s.summary.profit;
    }
  };
  const fewForRoi = (s: PlayerStat) => (sort === "roi" && s.summary.settled < ROI_MIN_BETS ? 1 : 0);
  return stats
    .filter((s) => s.summary.settled > 0)
    .sort((a, b) => fewForRoi(a) - fewForRoi(b) || value(b) - value(a) || b.summary.bets - a.summary.bets || a.label.localeCompare(b.label));
}
