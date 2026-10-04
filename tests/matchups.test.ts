import { describe, expect, it } from "vitest";
import { matchupBucket, matchupCount } from "@/lib/bets/matchups";
import { summarize, type BetRow } from "@/lib/bets/profit";

describe("previous matchups", () => {
  it("adds up the O/U record", () => {
    expect(matchupCount("11/3")).toBe(14);
    expect(matchupCount("115/69")).toBe(184);
    expect(matchupCount(" 4 / 2 ")).toBe(6);
    expect(matchupCount(null)).toBeNull();
    expect(matchupCount("")).toBeNull();
  });

  it("groups into under 10, 10-20 and over 20", () => {
    expect([0, 9, 10, 14, 20, 21, 184].map(matchupBucket)).toEqual(["LT10", "LT10", "10TO20", "10TO20", "10TO20", "GT20", "GT20"]);
    expect(matchupBucket(null)).toBeNull();
  });

  it("gives each group its own profit", () => {
    const row = (ou: string, result: "WON" | "LOST"): BetRow & { matchups: number | null } => ({
      id: ou + result, matchId: "m", playType: "BOT", competition: null, stake: 1, odds: 2, result, profit: result === "WON" ? 1 : -1, placedAt: "", matchups: matchupCount(ou),
    });
    const rows = [row("4/2", "WON"), row("11/3", "LOST"), row("12/6", "WON"), row("30/10", "WON")];
    const by = (b: string) => summarize(rows.filter((r) => matchupBucket(r.matchups) === b));
    expect([by("LT10").profit, by("10TO20").profit, by("GT20").profit]).toEqual([1, 0, 1]);
  });
});
