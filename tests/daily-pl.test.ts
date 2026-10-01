import { describe, expect, it } from "vitest";
import { cumulativeSeries, dailyPL, dayKey, niceTicks } from "@/lib/bets/daily";
import type { BetRow } from "@/lib/bets/profit";

const bet = (startsAt: string, result: BetRow["result"], profit: number | null, playType: BetRow["playType"] = "BOT") => ({
  id: Math.random().toString(36),
  matchId: "m",
  playType,
  competition: null,
  stake: 1,
  odds: 1.9,
  result,
  profit,
  placedAt: startsAt,
  startsAt,
});

const TZ = "Australia/Sydney";

describe("daily P/L", () => {
  it("groups settled bets by the Sydney calendar day of the match", () => {
    // 13:30 UTC = 11:30 PM Sydney on 1 Oct; 14:30 UTC = 12:30 AM on 2 Oct (AEST, UTC+10).
    expect(dayKey("2026-10-01T13:30:00Z", TZ)).toBe("2026-10-01");
    expect(dayKey("2026-10-01T14:30:00Z", TZ)).toBe("2026-10-02");
    const days = dailyPL(
      [
        bet("2026-10-01T09:00:00Z", "WON", 0.9),
        bet("2026-10-01T10:00:00Z", "LOST", -1),
        bet("2026-10-01T14:30:00Z", "VOID", 0),
        bet("2026-10-01T11:00:00Z", "PENDING", null),
        bet("2026-10-01T12:00:00Z", "WON", null), // no odds yet: not counted
      ],
      TZ,
    );
    expect(days.get("2026-10-01")).toEqual({ day: "2026-10-01", profit: -0.1, bets: 2, won: 1, lost: 1, void: 0 });
    expect(days.get("2026-10-02")).toMatchObject({ profit: 0, bets: 1, void: 1 });
    expect(days.size).toBe(2);
  });

  it("builds a running total with a point for every day, starting at 0", () => {
    const days = dailyPL([bet("2026-09-29T09:00:00Z", "WON", 2), bet("2026-10-01T09:00:00Z", "LOST", -1), bet("2026-09-20T09:00:00Z", "WON", 5)], TZ);
    const series = cumulativeSeries(days, "2026-09-29", "2026-10-02");
    expect(series.map((p) => [p.day, p.profit, p.cumulative])).toEqual([
      ["2026-09-29", 2, 2],
      ["2026-09-30", 0, 2],
      ["2026-10-01", -1, 1],
      ["2026-10-02", 0, 1],
    ]);
    expect(cumulativeSeries(days, "2026-10-02", "2026-10-01")).toEqual([]);
  });

  it("picks round axis ticks that include 0", () => {
    expect(niceTicks(-1, 0)).toEqual([-1, -0.75, -0.5, -0.25, 0]);
    expect(niceTicks(0, 0)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    const t = niceTicks(-3.2, 7.9);
    expect(t).toContain(0);
    expect(t[0]).toBeLessThanOrEqual(-3.2);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(7.9);
  });
});
