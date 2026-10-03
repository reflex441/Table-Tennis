import { describe, expect, it } from "vitest";
import { combineLegs } from "@/lib/bets/profit";
import { parseLegs, splitLegs } from "@/lib/bets/split";
import { betInputSchema } from "@/lib/validation/match";

describe("split bets", () => {
  it("totals: pending until every pick is settled, then won/lost by the net", () => {
    const under = { stake: 0.5, odds: 1.85, result: "PENDING" as const };
    const sweep = { stake: 0.5, odds: 3.2, result: "PENDING" as const };
    expect(combineLegs([under, sweep])).toEqual({ stake: 1, result: "PENDING", profit: null });
    expect(combineLegs([{ ...under, result: "WON" }, sweep])).toMatchObject({ result: "PENDING", profit: null });
    // Under wins (+0.43), sweep loses (-0.5): net -0.07 -> LOST.
    expect(combineLegs([{ ...under, result: "WON" }, { ...sweep, result: "LOST" }])).toEqual({ stake: 1, result: "LOST", profit: -0.07 });
    // Sweep wins (+1.1), under loses (-0.5): net +0.6 -> WON.
    expect(combineLegs([{ ...under, result: "LOST" }, { ...sweep, result: "WON" }])).toEqual({ stake: 1, result: "WON", profit: 0.6 });
    expect(combineLegs([{ ...under, result: "VOID" }, { ...sweep, result: "VOID" }])).toMatchObject({ result: "VOID", profit: 0 });
    // A won pick without odds: profit unknown until the odds are added.
    expect(combineLegs([{ ...under, odds: null, result: "WON" }, { ...sweep, result: "LOST" }])).toEqual({ stake: 1, result: "WON", profit: null });
  });

  it("editor helpers: split a stake in half and validate the picks", () => {
    expect(splitLegs(1, "UNDER", "1.85")).toEqual([
      { selection: "UNDER", stake: "0.5", odds: "1.85" },
      { selection: "SWEEP", stake: "0.5", odds: "" },
    ]);
    expect(splitLegs(1, "SWEEP", "").map((l) => l.selection)).toEqual(["SWEEP", "UNDER"]);
    expect(splitLegs(1.5, "OVER", "", 3).map((l) => [l.selection, l.stake])).toEqual([["OVER", "0.5"], ["SWEEP", "0.5"], ["UNDER", "0.5"]]);
    expect(parseLegs([{ selection: "UNDER", stake: "0.5", odds: "1.85" }, { selection: "SWEEP", stake: "0.5", odds: "" }])).toEqual([
      { selection: "UNDER", stake: 0.5, odds: 1.85 },
      { selection: "SWEEP", stake: 0.5, odds: null },
    ]);
    expect(parseLegs([{ selection: "UNDER", stake: "0", odds: "" }, { selection: "SWEEP", stake: "0.5", odds: "" }])).toMatch(/Pick 1: stake/);
    expect(parseLegs([{ selection: "UNDER", stake: "0.5", odds: "" }, { selection: "SWEEP", stake: "0.5", odds: "0.9" }])).toMatch(/Pick 2: odds/);
    // Confirming a placed bet needs the odds you got.
    expect(parseLegs([{ selection: "UNDER", stake: "0.5", odds: "1.85" }, { selection: "SWEEP", stake: "0.5", odds: "" }], { requireOdds: true })).toMatch(/Pick 2: enter the odds/);
  });

  it("validation: 2-3 picks", () => {
    const leg = { selection: "UNDER", stake: 0.5 };
    expect(betInputSchema.safeParse({ legs: [leg] }).success).toBe(false);
    expect(betInputSchema.safeParse({ legs: [leg, { ...leg, selection: "SWEEP" }] }).success).toBe(true);
    expect(betInputSchema.safeParse({ legs: [leg, leg, leg, leg] }).success).toBe(false);
    expect(betInputSchema.safeParse({ legs: null }).success).toBe(true);
    expect(betInputSchema.safeParse({ leg: { index: 1, result: "WON" } }).success).toBe(true);
  });
});
