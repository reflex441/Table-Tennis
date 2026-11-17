import { describe, expect, it } from "vitest";
import { byPair, byPlayer, rowIsFor, sortStats } from "@/lib/bets/by-player";
import { computeProfit, type BetResult } from "@/lib/bets/profit";

const bet = (player1: string, player2: string, stake: number, odds: number, result: BetResult) => ({
  player1,
  player2,
  stake,
  odds,
  result,
  profit: result === "PENDING" ? null : computeProfit(stake, odds, result),
});

// Latest first, as the Profit page has them.
const rows = [
  bet("Jablonski K.", "Komorowicz J.", 1, 1.9, "WON"), // +0.9
  bet("Komorowicz J.", "Jablonski K.", 1, 1.8, "WON"), // +0.8, same pair the other way round
  bet("Komorowicz J.", "Wiekiera A.", 1, 1.85, "LOST"), // -1
  bet("WIEKIERA A.", "Caban J.", 2, 2, "WON"), // +2 (old spelling)
  bet("Caban J.", "Skvrna J.", 1, 1.9, "PENDING"),
  bet("Skvrna J.", "Krupnik J.", 0.5, 3, "WON"), // +1, one bet
];

const view = (stats: ReturnType<typeof byPlayer>) => stats.map((s) => [s.label, s.summary.bets, s.summary.profit]);

describe("profit by player and by pair", () => {
  it("a bet counts for both players; names are grouped however they're spelled", () => {
    expect(view(sortStats(byPlayer(rows), "profit"))).toEqual([
      ["Caban J.", 2, 2], // its open bet counts as a bet, not in the profit
      ["Jablonski K.", 2, 1.7],
      ["Skvrna J.", 2, 1], // same profit: more bets first
      ["Wiekiera A.", 2, 1], // shown as last spelled
      ["Krupnik J.", 1, 1],
      ["Komorowicz J.", 3, 0.7],
    ]);
    expect(view(sortStats(byPlayer(rows), "loss"))[0]).toEqual(["Komorowicz J.", 3, 0.7]);
  });

  it("a pair is the two players in either order", () => {
    expect(view(sortStats(byPair(rows), "profit"))).toEqual([
      ["WIEKIERA A. vs Caban J.", 1, 2], // as spelled on its one bet
      ["Jablonski K. vs Komorowicz J.", 2, 1.7],
      ["Skvrna J. vs Krupnik J.", 1, 1],
      ["Komorowicz J. vs Wiekiera A.", 1, -1],
      // Caban vs Skvrna only has an open bet: not listed.
    ]);
  });

  it("ROI: a few lucky bets don't top the list; most bets", () => {
    const many = [...rows, bet("Komorowicz J.", "Caban J.", 1, 1.9, "WON"), bet("Komorowicz J.", "Caban J.", 1, 1.9, "WON")];
    const roi = sortStats(byPlayer(many), "roi").map((s) => [s.label, s.summary.settled, s.summary.roi]);
    // Komorowicz (5 settled) and Caban (3 settled) first, then those with fewer than 3.
    expect(roi.slice(0, 2).map((r) => r[0])).toEqual(["Caban J.", "Komorowicz J."]);
    expect(roi[2]).toEqual(["Skvrna J.", 1, 200]); // same ROI as Krupnik, more bets
    expect(sortStats(byPlayer(many), "bets")[0].label).toBe("Komorowicz J.");
  });

  it("which bets belong to a player or a pair", () => {
    const pair = byPair(rows).find((s) => s.label.startsWith("Jablonski"))!.key;
    expect(rows.filter((r) => rowIsFor(r, "pair", pair))).toHaveLength(2);
    expect(rows.filter((r) => rowIsFor(r, "player", "wiekiera a"))).toHaveLength(2);
  });
});
