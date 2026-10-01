"use client";

import { useMemo, useState } from "react";
import { DateTime } from "luxon";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { DayPL } from "@/lib/bets/daily";
import { formatMoney, formatUnits, round2 } from "@/lib/bets/profit";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Month calendar of daily P/L (units). Cells are tinted green/red by the
 * size of the day's result; click a day to filter the bet list to it.
 */
export function DailyCalendar({
  days,
  today,
  selected,
  onSelect,
  unitSize,
  currency,
}: {
  days: Map<string, DayPL>;
  today: string | null;
  selected: string | null;
  onSelect: (day: string | null) => void;
  unitSize: number;
  currency: string;
}) {
  // Month shown; null = the current month (or the latest month with bets before hydration).
  const [month, setMonth] = useState<string | null>(null);
  const monthKey = (month ?? today ?? [...days.keys()].sort().pop() ?? "").slice(0, 7);

  const { start, cells, total, maxAbs } = useMemo(() => {
    const start = DateTime.fromISO(`${monthKey || "2026-01"}-01`);
    const first = start.minus({ days: start.weekday - 1 }); // Monday on or before the 1st
    const cells: { day: string; inMonth: boolean }[] = [];
    for (let d = first; cells.length < 42; d = d.plus({ days: 1 })) {
      cells.push({ day: d.toISODate()!, inMonth: d.month === start.month });
      if (cells.length % 7 === 0 && d >= start.endOf("month")) break;
    }
    let total = { profit: 0, bets: 0, won: 0, lost: 0 };
    let maxAbs = 0;
    for (const c of cells) {
      const pl = c.inMonth ? days.get(c.day) : undefined;
      if (!pl) continue;
      total = { profit: round2(total.profit + pl.profit), bets: total.bets + pl.bets, won: total.won + pl.won, lost: total.lost + pl.lost };
      maxAbs = Math.max(maxAbs, Math.abs(pl.profit));
    }
    return { start, cells, total, maxAbs };
  }, [days, monthKey]);

  if (!monthKey) return null;

  const shift = (n: number) => setMonth(start.plus({ months: n }).toISODate());

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <button className="btn-ghost h-8 w-8 p-0" onClick={() => shift(-1)} aria-label="Previous month">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-center">
          <p className="text-sm font-semibold">{start.toFormat("LLLL yyyy")}</p>
          <p className="text-[11px] text-muted">
            {total.bets ? (
              <>
                <span className="tabular font-semibold text-text">{formatUnits(total.profit)}</span>{" "}
                <span className="tabular">{formatMoney(total.profit, unitSize, currency)}</span> · {total.won}W - {total.lost}L
              </>
            ) : (
              "No settled bets"
            )}
          </p>
        </div>
        <button className="btn-ghost h-8 w-8 p-0" onClick={() => shift(1)} aria-label="Next month">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[10px] uppercase tracking-wide text-muted">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-1">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1" role="grid" aria-label={`Daily profit, ${start.toFormat("LLLL yyyy")}`}>
        {cells.map(({ day, inMonth }) => {
          if (!inMonth) return <div key={day} aria-hidden="true" />;
          const pl = days.get(day);
          const isToday = day === today;
          const isSelected = day === selected;
          // Tint strength grows with the size of the day's result.
          const strength = pl && maxAbs ? 0.18 + 0.5 * (Math.abs(pl.profit) / maxAbs) : 0;
          const bg = !pl
            ? undefined
            : pl.profit > 0
              ? `color-mix(in oklab, var(--color-over) ${Math.round(strength * 100)}%, var(--color-panel))`
              : pl.profit < 0
                ? `color-mix(in oklab, var(--color-under) ${Math.round(strength * 100)}%, var(--color-panel))`
                : "var(--color-line)";
          const label = `${DateTime.fromISO(day).toFormat("ccc d LLL")}: ${
            pl ? `${formatUnits(pl.profit)} (${formatMoney(pl.profit, unitSize, currency)}), ${pl.won}W ${pl.lost}L${pl.void ? ` ${pl.void}V` : ""}` : "no bets"
          }`;
          return (
            <button
              key={day}
              role="gridcell"
              aria-selected={isSelected}
              title={label}
              aria-label={label}
              disabled={!pl}
              onClick={() => onSelect(isSelected ? null : day)}
              className={`flex aspect-square min-h-11 flex-col items-start justify-between rounded-lg border p-1 text-left transition-[filter] sm:aspect-auto sm:h-16 sm:p-1.5 ${
                isSelected ? "border-accent ring-2 ring-accent" : isToday ? "border-warn/80" : "border-line"
              } ${pl ? "cursor-pointer hover:brightness-125" : "cursor-default bg-bg/40"}`}
              style={bg ? { background: bg } : undefined}
            >
              <span className={`text-[10px] sm:text-[11px] ${pl ? "text-text/80" : "text-muted"}`}>{DateTime.fromISO(day).day}</span>
              {pl && (
                <span className="w-full">
                  <span className="block text-[11px] font-bold leading-tight tabular text-text sm:text-sm">{formatUnits(pl.profit)}</span>
                  <span className="hidden text-[10px] leading-tight tabular text-text/70 sm:block">{formatMoney(pl.profit, unitSize, currency)}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
