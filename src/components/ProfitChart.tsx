"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import { niceTicks, type CumulativePoint } from "@/lib/bets/daily";
import { formatMoney, formatUnits } from "@/lib/bets/profit";

const HEIGHT = 300;
const PAD = { top: 12, right: 14, bottom: 26, left: 52 };

/**
 * Running profit (units) over the selected period: one line, area tinted
 * green above 0 and red below, crosshair + tooltip on hover / arrow keys.
 */
export function ProfitChart({ points, unitSize, currency }: { points: CumulativePoint[]; unitSize: number; currency: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  const clipId = useId().replace(/:/g, "");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geo = useMemo(() => {
    const values = points.map((p) => p.cumulative);
    const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
    const lo = ticks[0];
    const hi = ticks[ticks.length - 1];
    const innerW = width - PAD.left - PAD.right;
    const innerH = HEIGHT - PAD.top - PAD.bottom;
    const x = (i: number) => PAD.left + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
    const y = (v: number) => PAD.top + ((hi - v) / (hi - lo)) * innerH;
    const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.cumulative).toFixed(1)}`).join("");
    const zeroY = y(0);
    const area = points.length ? `${line}L${x(points.length - 1).toFixed(1)},${zeroY}L${x(0).toFixed(1)},${zeroY}Z` : "";
    // Evenly spaced date labels, at least ~64px apart, always including the last day.
    const lastIdx = points.length - 1;
    const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(innerW / 64))));
    const xLabels = points
      .map((p, i) => ({ i, day: p.day }))
      .filter(({ i }) => i === lastIdx || (i % labelEvery === 0 && (i === 0 || x(lastIdx) - x(i) >= 56)));
    return { ticks, x, y, line, area, zeroY, innerW, xLabels };
  }, [points, width]);

  if (points.length === 0) {
    return <p className="py-10 text-center text-sm text-muted">No settled bets in this period yet.</p>;
  }

  const last = points.length - 1;
  const active = hover ?? null;
  const p = active !== null ? points[active] : null;
  const end = points[last].cumulative;

  const pick = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const rel = (clientX - rect.left - PAD.left) / Math.max(1, geo.innerW);
    setHover(Math.max(0, Math.min(last, Math.round(rel * last))));
  };

  return (
    <div
      ref={ref}
      className="relative w-full min-w-0 select-none overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-accent"
      tabIndex={0}
      role="img"
      aria-label={`Running profit: ${formatUnits(end)} over ${points.length} day(s). Use the arrow keys to read each day.`}
      onPointerMove={(e) => pick(e.clientX)}
      onPointerDown={(e) => pick(e.clientX)}
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
        <defs>
          <clipPath id={`${clipId}-up`}>
            <rect x={0} y={0} width={width} height={Math.max(0, geo.zeroY)} />
          </clipPath>
          <clipPath id={`${clipId}-down`}>
            <rect x={0} y={geo.zeroY} width={width} height={Math.max(0, HEIGHT - geo.zeroY)} />
          </clipPath>
        </defs>

        {/* Grid + y axis labels (recessive). */}
        {geo.ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={geo.y(t)} y2={geo.y(t)} className={t === 0 ? "stroke-muted/60" : "stroke-line/70"} strokeWidth={1} />
            <text x={PAD.left - 8} y={geo.y(t)} dy="0.32em" textAnchor="end" className="fill-muted text-[10px] tabular">
              {formatUnits(t, false)}
            </text>
          </g>
        ))}
        {geo.xLabels.map(({ i, day }) => (
          <text
            key={day}
            x={geo.x(i)}
            y={HEIGHT - 8}
            textAnchor={points.length === 1 ? "middle" : i === 0 ? "start" : i === last ? "end" : "middle"}
            className="fill-muted text-[10px]"
          >
            {DateTime.fromISO(day).toFormat("d LLL")}
          </text>
        ))}

        {/* Area: green above 0, red below. */}
        <path d={geo.area} className="fill-over/15" clipPath={`url(#${clipId}-up)`} />
        <path d={geo.area} className="fill-under/15" clipPath={`url(#${clipId}-down)`} />
        <path d={geo.line} fill="none" className="stroke-text" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {/* End marker with a surface ring. */}
        <circle cx={geo.x(last)} cy={geo.y(end)} r={4.5} className={`${end >= 0 ? "fill-over" : "fill-under"} stroke-panel`} strokeWidth={2} />

        {p && active !== null && (
          <g>
            <line x1={geo.x(active)} x2={geo.x(active)} y1={PAD.top} y2={HEIGHT - PAD.bottom} className="stroke-muted/70" strokeWidth={1} />
            <circle cx={geo.x(active)} cy={geo.y(p.cumulative)} r={4.5} className="fill-text stroke-panel" strokeWidth={2} />
          </g>
        )}
      </svg>

      {p && active !== null && (
        <div
          className="pointer-events-none absolute top-1 z-10 min-w-36 rounded-lg border border-line bg-panel-2 px-2.5 py-1.5 text-xs shadow-xl shadow-black/40"
          style={geo.x(active) > width / 2 ? { right: width - geo.x(active) + 10 } : { left: geo.x(active) + 10 }}
        >
          <p className="text-muted">{DateTime.fromISO(p.day).toFormat("ccc d LLL yyyy")}</p>
          <p className="mt-0.5">
            <span className="tabular font-semibold text-text">{formatUnits(p.cumulative)}</span>{" "}
            <span className="tabular text-muted">{formatMoney(p.cumulative, unitSize, currency)}</span>
            <span className="text-muted"> total</span>
          </p>
          <p>
            <span className="tabular font-semibold text-text">{p.bets ? formatUnits(p.profit) : "–"}</span>{" "}
            {p.bets > 0 && <span className="tabular text-muted">{formatMoney(p.profit, unitSize, currency)}</span>}
            <span className="text-muted"> that day{p.bets ? ` · ${p.bets} bet${p.bets === 1 ? "" : "s"}` : ""}</span>
          </p>
        </div>
      )}
    </div>
  );
}
