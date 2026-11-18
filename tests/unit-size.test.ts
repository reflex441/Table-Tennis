import { describe, expect, it } from "vitest";
import { ALL_TIME, changeTipsterUnitSize, historyAfterChange, parseTipsterUnitSizes, parseUnitSizeHistory, tipsterUnitSizeAt, unitSizeAt } from "@/lib/bets/unit-size";
import { computeProfit, formatMoneyOf, summarize, type BetResult } from "@/lib/bets/profit";
import { cumulativeSeries, dailyPL } from "@/lib/bets/daily";

const switchAt = "2026-11-18T04:00:00.000Z";
const settings = { unitSize: 300, unitSizeHistory: [{ until: switchAt, unitSize: 200 }] };

describe("what a unit was worth when", () => {
  it("bets before the change keep $200 a unit, later ones $300", () => {
    expect(unitSizeAt(settings, "2026-11-17T09:00:00Z")).toBe(200);
    expect(unitSizeAt(settings, switchAt)).toBe(300);
    expect(unitSizeAt(settings, new Date("2026-11-19T09:00:00Z"))).toBe(300);
    expect(unitSizeAt(settings, null)).toBe(300);
    expect(unitSizeAt({ unitSize: 200 }, "2020-01-01T00:00:00Z")).toBe(200);
    // Several changes: $10, then $200, now $300.
    const three = { unitSize: 300, unitSizeHistory: [{ until: "2026-01-01T00:00:00.000Z", unitSize: 10 }, { until: switchAt, unitSize: 200 }] };
    expect([unitSizeAt(three, "2025-06-01T00:00:00Z"), unitSizeAt(three, "2026-06-01T00:00:00Z"), unitSizeAt(three, "2026-12-01T00:00:00Z")]).toEqual([10, 200, 300]);
  });

  it("changing the unit size remembers the old one for the bets before", () => {
    const now = new Date(switchAt);
    expect(historyAfterChange([], 200, 300, now, true)).toEqual([{ until: switchAt, unitSize: 200 }]);
    // No bets yet (e.g. setting it up the first time): nothing to remember.
    expect(historyAfterChange([], 10, 200, now, false)).toEqual([]);
    expect(historyAfterChange([], 200, 200, now, true)).toEqual([]);
    // A typo fixed a few minutes later ($30, then $300): the bets before keep $200.
    const typo = historyAfterChange([], 200, 30, now, true);
    const later = new Date(now.getTime() + 3 * 60_000);
    expect(historyAfterChange(typo, 30, 300, later, true)).toEqual([{ until: later.toISOString(), unitSize: 200 }]);
    // Changed back straight away: as if it never changed.
    expect(historyAfterChange(typo, 30, 200, later, true)).toEqual([]);
    // Much later, another raise: added after the first.
    const month = new Date(now.getTime() + 30 * 86_400_000);
    expect(historyAfterChange([{ until: switchAt, unitSize: 200 }], 300, 400, month, true)).toEqual([
      { until: switchAt, unitSize: 200 },
      { until: month.toISOString(), unitSize: 300 },
    ]);
  });

  it("reads only valid entries, oldest first", () => {
    expect(parseUnitSizeHistory(null)).toEqual([]);
    expect(
      parseUnitSizeHistory([{ until: "2026-11-18T04:00:00Z", unitSize: 200 }, { until: "2026-01-01T00:00:00Z", unitSize: 10 }, { until: "nope", unitSize: 5 }, { until: "2026-02-01T00:00:00Z", unitSize: -1 }]),
    ).toEqual([
      { until: "2026-01-01T00:00:00.000Z", unitSize: 10 },
      { until: "2026-11-18T04:00:00.000Z", unitSize: 200 },
    ]);
  });
});

describe("money totals add up what each bet paid", () => {
  const bet = (startsAt: string, stake: number, odds: number, result: BetResult) => ({
    startsAt,
    stake,
    odds,
    result,
    profit: computeProfit(stake, odds, result),
    unitSize: unitSizeAt(settings, startsAt),
  });
  // +1u at $200 (paid $200 profit), then -1u at $300 (lost $300).
  const rows = [bet("2026-11-17T09:00:00Z", 1, 2, "WON"), bet("2026-11-19T09:00:00Z", 1, 1.9, "LOST")];

  it("totals: units still add up the same; money is per bet", () => {
    const s = summarize(rows);
    expect(s.profit).toBe(0);
    expect(s.profitMoney).toBe(-100); // +$200 - $300, not 0 x $300
    expect(formatMoneyOf(s.profit, s.profitMoney, 300, "$")).toBe("-$100.00");
    // Rows that don't say their unit size: today's (as before).
    expect(summarize(rows.map((r) => ({ ...r, unitSize: undefined }))).profitMoney).toBeNull();
    expect(formatMoneyOf(1, null, 300, "$")).toBe("+$300.00");
  });

  it("daily P/L and the running total in money", () => {
    const days = dailyPL(rows, "Australia/Sydney");
    expect([...days.values()].map((d) => [d.day, d.profit, d.money])).toEqual([
      ["2026-11-17", 1, 200],
      ["2026-11-19", -1, -300],
    ]);
    const series = cumulativeSeries(days, "2026-11-17", "2026-11-19");
    expect(series.map((p) => [p.cumulative, p.cumulativeMoney])).toEqual([
      [1, 200],
      [1, 200],
      [0, -100],
    ]);
  });
});

describe("NBA: a unit size per tipster", () => {
  const now = new Date("2026-11-19T00:00:00.000Z");
  const s = {
    unitSize: 300,
    unitSizeHistory: [{ until: switchAt, unitSize: 200 }],
    nbaUnitSizes: parseTipsterUnitSizes([
      { tipster: "ADP", unitSize: 200, since: now.toISOString(), history: [] },
      { tipster: "Tyvan", unitSize: 300, since: ALL_TIME, history: [] },
      { tipster: "A1", unitSize: 300, since: now.toISOString(), history: [] },
      { tipster: "adp", unitSize: 999, since: ALL_TIME, history: [] }, // same tipster twice: the first counts
    ]),
  };

  it("their bets from when it was set use it; earlier ones and other tipsters use yours", () => {
    expect(s.nbaUnitSizes).toHaveLength(3);
    expect(tipsterUnitSizeAt(s, "ADP", "2026-11-20T00:00:00Z")).toBe(200);
    expect(tipsterUnitSizeAt(s, "adp ", "2026-11-20T00:00:00Z")).toBe(200); // however it's written
    expect(tipsterUnitSizeAt(s, "ADP", "2026-11-10T00:00:00Z")).toBe(200); // before: yours then ($200)
    expect(tipsterUnitSizeAt(s, "A1", "2026-11-18T12:00:00Z")).toBe(300); // before it was set: yours then ($300)
    expect(tipsterUnitSizeAt(s, "A1", "2026-11-10T00:00:00Z")).toBe(200);
    expect(tipsterUnitSizeAt(s, "Tyvan", "2026-11-10T00:00:00Z")).toBe(300); // "also their earlier bets"
    expect(tipsterUnitSizeAt(s, "Someone", "2026-11-20T00:00:00Z")).toBe(300);
    expect(tipsterUnitSizeAt(s, null, "2026-11-10T00:00:00Z")).toBe(200);
  });

  it("changing a tipster's unit size keeps the old one for their earlier bets", () => {
    const adp = s.nbaUnitSizes[0];
    const later = new Date(now.getTime() + 7 * 86_400_000);
    const raised = changeTipsterUnitSize(adp, 250, later);
    expect(raised).toMatchObject({ unitSize: 250, history: [{ until: later.toISOString(), unitSize: 200 }] });
    const t = { ...s, nbaUnitSizes: [raised] };
    expect([tipsterUnitSizeAt(t, "ADP", "2026-11-21T00:00:00Z"), tipsterUnitSizeAt(t, "ADP", "2026-11-27T00:00:00Z")]).toEqual([200, 250]);
    // Fixed right after setting it: just the new amount.
    expect(changeTipsterUnitSize(adp, 220, new Date(now.getTime() + 60_000))).toMatchObject({ unitSize: 220, history: [] });
  });
});
