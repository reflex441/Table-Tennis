import { describe, expect, it } from "vitest";
import { combineSlipParts, sameSlipPick } from "@/lib/bets/slip-combine";
import { combineLegs, computeProfit, round2 } from "@/lib/bets/profit";
import { pastBetSchema } from "@/lib/validation/match";

describe("combining bets on the same pick from bet slips", () => {
  it("adds up the stakes and uses the odds the total paid out", () => {
    // Over 75.5 $250 @ 1.80 (won $450) + Over 74.5 $200 @ 1.73 (won $346).
    const c = combineSlipParts([
      { stake: 250, odds: 1.8, result: "WON", pointsLine: 75.5 },
      { stake: 200, odds: 1.73, result: "WON", pointsLine: 74.5 },
    ]);
    expect(c).toEqual({ stake: 450, odds: 1.7689, result: "WON", pointsLine: 75.5, legs: null });
    // With 1u = $200: 2.25u, profit 1.73u = $346 (200 + 146).
    const units = round2(c.stake / 200);
    expect(units).toBe(2.25);
    expect(computeProfit(units, c.odds, "WON")).toBe(1.73);
  });

  it("lost bets lose the total stake; a part without odds leaves the odds to fill in", () => {
    expect(combineSlipParts([
      { stake: 100, odds: 1.9, result: "LOST", pointsLine: 73.5 },
      { stake: 50, odds: 1.8, result: "LOST", pointsLine: 74.5 },
    ])).toMatchObject({ stake: 150, odds: 1.8667, result: "LOST", legs: null });
    expect(combineSlipParts([
      { stake: 100, odds: null, result: "WON", pointsLine: 73.5 },
      { stake: 50, odds: 1.8, result: "WON", pointsLine: 74.5 },
    ])).toMatchObject({ stake: 150, odds: null });
  });

  it("bets that settled differently become a split bet, one pick per result", () => {
    // Total of 75: Over 74.5 won, Over 75.5 lost.
    const c = combineSlipParts([
      { stake: 250, odds: 1.8, result: "LOST", pointsLine: 75.5 },
      { stake: 200, odds: 1.73, result: "WON", pointsLine: 74.5 },
    ]);
    expect(c).toEqual({
      stake: 450,
      odds: null,
      result: "LOST",
      pointsLine: 75.5,
      legs: [
        { stake: 200, odds: 1.73, result: "WON" },
        { stake: 250, odds: 1.8, result: "LOST" },
      ],
    });
    // Net: +146 - 250 = -104.
    const legs = c.legs!.map((l) => ({ ...l, stake: l.stake / 100 }));
    expect(combineLegs(legs)).toEqual({ stake: 4.5, result: "LOST", profit: -1.04 });
  });

  it("Over/Under on any line is the same pick; spreads and sweeps only on the same line", () => {
    expect(sameSlipPick({ selection: "OVER", pointsLine: 75.5 }, { selection: "OVER", pointsLine: 74.5 })).toBe(true);
    expect(sameSlipPick({ selection: "OVER", pointsLine: 75.5 }, { selection: "UNDER", pointsLine: 75.5 })).toBe(false);
    expect(sameSlipPick({ selection: "POINTS_SPREAD", pointsLine: -4.5 }, { selection: "POINTS_SPREAD", pointsLine: 4.5 })).toBe(false);
    expect(sameSlipPick({ selection: "POINTS_SPREAD", pointsLine: -4.5 }, { selection: "POINTS_SPREAD", pointsLine: -4.5 })).toBe(true);
    expect(sameSlipPick({ selection: null, pointsLine: null }, { selection: null, pointsLine: null })).toBe(false);
    // An ML on each player isn't the same bet; two on the same player are.
    expect(sameSlipPick({ selection: "ML", pointsLine: null, text: "Mateusz Sikon" }, { selection: "ML", pointsLine: null, text: "Pawel Slosarczyk" })).toBe(false);
    expect(sameSlipPick({ selection: "ML", pointsLine: null, text: "Mateusz Sikon" }, { selection: "ML", pointsLine: null, text: "Mateusz  Sikon" })).toBe(true);
  });

  it("a split past bet needs its pick", () => {
    const base = { player1: "Heczko D.", player2: "Byrtus S.", competition: null, startsAt: "2026-10-14T15:30:00Z", timezone: "Australia/Sydney", playType: "PERSONAL", pointsLine: 75.5, stake: 4.5, odds: null, result: "LOST" };
    const legs = [{ stake: 2, odds: 1.73, result: "WON" }, { stake: 2.5, odds: 1.8, result: "LOST" }];
    expect(pastBetSchema.safeParse({ ...base, selection: "OVER", legs }).success).toBe(true);
    expect(pastBetSchema.safeParse({ ...base, selection: null, legs }).success).toBe(false);
  });
});

describe("bot plays are Over / Under only", () => {
  it("a sweep or spread is always a personal play", async () => {
    const { canBeBot, playTypeFor } = await import("@/lib/selection");
    const { slipPlayType } = await import("@/lib/bets/slip-play");
    expect([canBeBot("OVER"), canBeBot("UNDER"), canBeBot(null), canBeBot("SWEEP"), canBeBot("POINTS_SPREAD"), canBeBot("SET_SPREAD"), canBeBot("ML")]).toEqual([true, true, true, false, false, false, false]);
    expect(playTypeFor("SWEEP", "BOT")).toBe("PERSONAL");
    expect(playTypeFor("OVER", "BOT")).toBe("BOT");
    expect(playTypeFor("SWEEP", "PERSONAL")).toBe("PERSONAL");
    // A slip's sweep on a bot match without a pick is still personal.
    expect(slipPlayType({ playType: "BOT", selection: null }, "SWEEP")).toBe("PERSONAL");
    expect(slipPlayType({ playType: "BOT", selection: null }, "OVER")).toBe("BOT");
  });
});
