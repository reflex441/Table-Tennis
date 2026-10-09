"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import { niceTicks, type CumulativePoint } from "@/lib/bets/daily";
import { formatMoney, formatUnits } from "@/lib/bets/profit";
import { SELECTION_LABEL, type Selection } from "@/lib/selection";

const HEIGHT = 300;
const PAD = { top: 12, right: 64, bottom: 26, left: 52 };

/**
 * Line colours per pick (validated for colour-blind separation on the dark
 * surface); lines also differ by dash pattern and carry direct labels, so
 * colour is never the only cue.
 */
export const PICK_SERIES: Record<Selection, { color: string; dash?: string }> = {
  OVER: { color: "#17ad4e" },
  UNDER: { color: "#c22541", dash: "6 4" },
  SWEEP: { color: "#8b5cf6", dash: "2 3" },
  POINTS_SPREAD: { color: "#0ea5e9", dash: "8 3 2 3" },
  SET_SPREAD: { color: "#f59e0b", dash: "1 3" },
};

export interface PickSeries {
  pick: Selection;
  points: CumulativePoint[];
}

/** Running profit (units) of OVER, UNDER and SWEEP picks over the same days. */
export function PickCompareChart({ series, unitSize, currency }: { series: PickSeries[]; unitSize: number; currency: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(260, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const shown = useMemo(() => series.filter((s) => s.points.some((p) => p.bets > 0)), [series]);
  const days = useMemo(() => series[0]?.points ?? [], [series]);
  const n = days.length;

  const geo = useMemo(() => {
    const values = shown.flatMap((s) => s.points.map((p) => p.cumulative));
    const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
    const lo = ticks[0];
    const hi = ticks[ticks.length - 1];
    const innerW = width - PAD.left - PAD.right;
    const innerH = HEIGHT - PAD.top - PAD.bottom;
    const x = (i: number) => PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const y = (v: number) => PAD.top + ((hi - v) / (hi - lo)) * innerH;
    const lines = shown.map((s) => ({
      pick: s.pick,
      d: s.points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.cumulative).toFixed(1)}`).join(""),
      end: s.points[n - 1]?.cumulative ?? 0,
    }));
    // End labels, nudged apart so they never overlap.
    const labels = lines.map((l) => ({ pick: l.pick, end: l.end, y: y(l.end) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 13);
    // Evenly spaced date labels, at least ~64px apart, always including the last day.
    const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 64))));
    const xLabels = days
      .map((p, i) => ({ i, day: p.day }))
      .filter(({ i }) => i === n - 1 || (i % labelEvery === 0 && (i === 0 || x(n - 1) - x(i) >= 56)));
    return { ticks, x, y, lines, labels, innerW, xLabels };
  }, [shown, days, n, width]);

  if (!shown.length) {
    return <p className="py-10 text-center text-sm text-muted">No settled OVER, UNDER or SWEEP bets in this period yet.</p>;
  }

  const last = n - 1;
  const pickAt = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const rel = (clientX - rect.left - PAD.left) / Math.max(1, geo.innerW);
    setHover(Math.max(0, Math.min(last, Math.round(rel * last))));
  };

  return (
    <div>
      {/* Legend: line keys matching the marks. */}
      <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legend">
        {shown.map((s) => (
          <li key={s.pick} className="flex items-center gap-1.5">
            <svg width="22" height="8" aria-hidden="true">
              <line x1="1" x2="21" y1="4" y2="4" stroke={PICK_SERIES[s.pick].color} strokeWidth="2" strokeDasharray={PICK_SERIES[s.pick].dash} strokeLinecap="round" />
            </svg>
            {SELECTION_LABEL[s.pick]}
          </li>
        ))}
      </ul>
      <div
        ref={ref}
        className="relative w-full min-w-0 select-none overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-accent"
        tabIndex={0}
        role="img"
        aria-label={`Running profit by pick: ${shown.map((s) => `${SELECTION_LABEL[s.pick]} ${formatUnits(s.points[last]?.cumulative ?? 0)}`).join(", ")}. Use the arrow keys to read each day.`}
        onPointerMove={(e) => pickAt(e.clientX)}
        onPointerDown={(e) => pickAt(e.clientX)}
        onPointerLeave={() => setHover(null)}
        onBlur={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? last) - 1));
          else if (e.key === "ArrowRight") setHover((h) => Math.min(last, (h ?? -1) + 1));
          else if (e.key === "Home") setHover(0);
          else if (e.key === "End") setHover(last);
          else return;
          e.preventDefault();
        }}
      >
        <svg width={width} height={HEIGHT} className="block" aria-hidden="true">
          {geo.ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={geo.y(t)} y2={geo.y(t)} className={t === 0 ? "stroke-muted/60" : "stroke-line/70"} strokeWidth={1} />
              <text x={PAD.left - 8} y={geo.y(t)} dy="0.32em" textAnchor="end" className="fill-muted text-[10px] tabular">
                {formatUnits(t, false)}
              </text>
            </g>
          ))}
          {geo.xLabels.map(({ i, day }) => (
            <text key={day} x={geo.x(i)} y={HEIGHT - 8} textAnchor={n === 1 ? "middle" : i === 0 ? "start" : i === last ? "end" : "middle"} className="fill-muted text-[10px]">
              {DateTime.fromISO(day).toFormat("d LLL")}
            </text>
          ))}
          {geo.lines.map((l) => (
            <path
              key={l.pick}
              d={l.d}
              fill="none"
              stroke={PICK_SERIES[l.pick].color}
              strokeWidth={2}
              strokeDasharray={PICK_SERIES[l.pick].dash}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {/* Direct labels at the line ends (text in text colours; the key carries identity). */}
          {geo.labels.map((l) => (
            <g key={l.pick}>
              <circle cx={geo.x(last)} cy={geo.y(l.end)} r={4} fill={PICK_SERIES[l.pick].color} className="stroke-panel" strokeWidth={2} />
              <text x={geo.x(last) + 8} y={l.y} dy="0.32em" className="fill-text text-[10px] font-semibold tabular">
                {SELECTION_LABEL[l.pick]}
              </text>
            </g>
          ))}
          {hover !== null && (
            <g>
              <line x1={geo.x(hover)} x2={geo.x(hover)} y1={PAD.top} y2={HEIGHT - PAD.bottom} className="stroke-muted/70" strokeWidth={1} />
              {shown.map((s) => (
                <circle key={s.pick} cx={geo.x(hover)} cy={geo.y(s.points[hover].cumulative)} r={4} fill={PICK_SERIES[s.pick].color} className="stroke-panel" strokeWidth={2} />
              ))}
            </g>
          )}
        </svg>

        {hover !== null && (
          <div
            className="pointer-events-none absolute top-1 z-10 min-w-40 rounded-lg border border-line bg-panel-2 px-2.5 py-1.5 text-xs shadow-xl shadow-black/40"
            style={geo.x(hover) > width / 2 ? { right: width - geo.x(hover) + 10 } : { left: geo.x(hover) + 10 }}
          >
            <p className="mb-0.5 text-muted">{DateTime.fromISO(days[hover].day).toFormat("ccc d LLL yyyy")}</p>
            {shown.map((s) => {
              const p = s.points[hover];
              return (
                <p key={s.pick} className="flex items-center gap-1.5">
                  <svg width="14" height="6" aria-hidden="true">
                    <line x1="1" x2="13" y1="3" y2="3" stroke={PICK_SERIES[s.pick].color} strokeWidth="2" strokeDasharray={PICK_SERIES[s.pick].dash} />
                  </svg>
                  <span className="tabular font-semibold text-text">{formatUnits(p.cumulative)}</span>
                  <span className="tabular text-muted">{formatMoney(p.cumulative, unitSize, currency)}</span>
                  <span className="text-muted">{SELECTION_LABEL[s.pick]}</span>
                </p>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
