import { DateTime } from "luxon";
import { round2, type BetRow } from "./profit";

/** P/L of one calendar day (in the user's timezone), in units. */
export interface DayPL {
  day: string; // yyyy-MM-dd
  profit: number;
  bets: number;
  won: number;
  lost: number;
  void: number;
}

type DatedRow = BetRow & { startsAt: string };

/** Local calendar day of a match (the day it was played). */
export function dayKey(iso: string, timezone: string): string {
  return DateTime.fromISO(iso).setZone(timezone).toISODate()!;
}

/** Settled bets with a known profit, grouped by the day the match was played. */
export function dailyPL(rows: DatedRow[], timezone: string): Map<string, DayPL> {
  const days = new Map<string, DayPL>();
  for (const r of rows) {
    if (r.result === "PENDING" || r.profit === null) continue;
    const day = dayKey(r.startsAt, timezone);
    const d = days.get(day) ?? { day, profit: 0, bets: 0, won: 0, lost: 0, void: 0 };
    d.profit = round2(d.profit + r.profit);
    d.bets++;
    if (r.result === "WON") d.won++;
    else if (r.result === "LOST") d.lost++;
    else d.void++;
    days.set(day, d);
  }
  return days;
}

export interface CumulativePoint {
  day: string;
  /** P/L of this day. */
  profit: number;
  /** Running total at the end of this day. */
  cumulative: number;
  bets: number;
}

/**
 * One point per day from `from` to `to` (inclusive) with the running total.
 * Profit from days before `from` is not included, so the line starts at 0.
 */
export function cumulativeSeries(days: Map<string, DayPL>, from: string, to: string): CumulativePoint[] {
  const out: CumulativePoint[] = [];
  let d = DateTime.fromISO(from);
  const end = DateTime.fromISO(to);
  if (!d.isValid || !end.isValid || d > end) return out;
  let total = 0;
  // Bounded: at most ~10 years of days.
  for (let i = 0; d <= end && i < 3700; i++, d = d.plus({ days: 1 })) {
    const key = d.toISODate()!;
    const pl = days.get(key);
    total = round2(total + (pl?.profit ?? 0));
    out.push({ day: key, profit: pl?.profit ?? 0, cumulative: total, bets: pl?.bets ?? 0 });
  }
  return out;
}

/** "Nice" axis ticks covering [min, max] and always including 0. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  let lo = Math.min(0, min);
  let hi = Math.max(0, max);
  if (lo === hi) hi = lo + 1;
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(round2(v));
  return ticks;
}
