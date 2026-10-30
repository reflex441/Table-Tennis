"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import { niceTicks, type CumulativePoint } from "@/lib/bets/daily";
import { formatMoney, formatUnits } from "@/lib/bets/profit";
import { smoothPath } from "@/lib/chart-path";

const HEIGHT = 300;
const PAD = { top: 16, right: 16, bottom: 28, left: 52 };

/**
 * Running profit (units) over the selected period: a smooth line, green
 * above 0 and red below, over a fading wash; the period's total in a pill;
 * crosshair + tooltip card on hover / arrow keys.
 */
export function ProfitChart({ points, unitSize, currency }: { points: CumulativePoint[]; unitSize: number; currency: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  const id = useId().replace(/:/g, "");

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
    const line = smoothPath(points.map((p, i) => ({ x: x(i), y: y(p.cumulative) })));
    const zeroY = y(0);
    const area = points.length ? `${line}L${x(points.length - 1).toFixed(1)},${zeroY}L${x(0).toFixed(1)},${zeroY}Z` : "";
    // Evenly spaced date labels, at least ~64px apart, always including the last day.
    const lastIdx = points.length - 1;
    const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(innerW / 64))));
    const xLabels = points
      .map((p, i) => ({ i, day: p.day }))
      .filter(({ i }) => i === lastIdx || (i % labelEvery === 0 && (i === 0 || x(lastIdx) - x(i) >= 56)));
    // The wash is strongest at the peak (and at the deepest loss) and fades to 0.
    const peakY = y(Math.max(0, ...values));
    const troughY = y(Math.min(0, ...values));
    return { ticks, x, y, line, area, zeroY, peakY, troughY, innerW, xLabels };
  }, [points, width]);

  if (points.length === 0) {
    return <p className="py-10 text-center text-sm text-muted">No settled bets in this period yet.</p>;
  }

  const last = points.length - 1;
  const p = hover !== null ? points[hover] : null;
  const end = points[last].cumulative;
  // Full class names (Tailwind only generates classes it finds written out).
  const fill = (v: number) => (v >= 0 ? "fill-over" : "fill-under");
  const key = (v: number) => (v >= 0 ? "bg-over" : "bg-under");
  const bottom = HEIGHT - PAD.bottom;

  const pick = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const rel = (clientX - rect.left - PAD.left) / Math.max(1, geo.innerW);
    setHover(Math.max(0, Math.min(last, Math.round(rel * last))));
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex justify-end">
        <span
          className={`rounded-lg border px-2.5 py-1 text-sm font-semibold tabular ${end >= 0 ? "border-over/30 bg-over/10 text-over" : "border-under/30 bg-under/10 text-under"}`}
          title="Profit over this period"
        >
          {formatUnits(end)} <span className="font-normal opacity-80">{formatMoney(end, unitSize, currency)}</span>
        </span>
      </div>
      <div
        ref={ref}
        className="relative w-full min-w-0 select-none overflow-hidden rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
            <clipPath id={`${id}-up`}>
              <rect x={0} y={0} width={width} height={Math.max(0, geo.zeroY)} />
            </clipPath>
            <clipPath id={`${id}-down`}>
              <rect x={0} y={geo.zeroY} width={width} height={Math.max(0, HEIGHT - geo.zeroY)} />
            </clipPath>
            {/* The wash fades towards the zero line. */}
            <linearGradient id={`${id}-fill-up`} gradientUnits="userSpaceOnUse" x1={0} x2={0} y1={geo.peakY} y2={Math.max(geo.peakY + 1, geo.zeroY)}>
              <stop offset="0%" style={{ stopColor: "var(--color-over)", stopOpacity: 0.34 }} />
              <stop offset="100%" style={{ stopColor: "var(--color-over)", stopOpacity: 0.03 }} />
            </linearGradient>
            <linearGradient id={`${id}-fill-down`} gradientUnits="userSpaceOnUse" x1={0} x2={0} y1={Math.min(geo.troughY - 1, geo.zeroY)} y2={geo.troughY}>
              <stop offset="0%" style={{ stopColor: "var(--color-under)", stopOpacity: 0.03 }} />
              <stop offset="100%" style={{ stopColor: "var(--color-under)", stopOpacity: 0.3 }} />
            </linearGradient>
          </defs>

          {/* Grid + y axis labels (recessive hairlines; 0 a step stronger). */}
          {geo.ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={geo.y(t)} y2={geo.y(t)} className={t === 0 ? "stroke-muted/50" : "stroke-line/60"} strokeWidth={1} />
              <text x={PAD.left - 10} y={geo.y(t)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular">
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
              className="fill-muted text-[11px]"
            >
              {DateTime.fromISO(day).toFormat("LLL d")}
            </text>
          ))}

          {/* Area and line: green above 0, red below. */}
          <path d={geo.area} fill={`url(#${id}-fill-up)`} clipPath={`url(#${id}-up)`} />
          <path d={geo.area} fill={`url(#${id}-fill-down)`} clipPath={`url(#${id}-down)`} />
          <path d={geo.line} fill="none" className="stroke-over" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" clipPath={`url(#${id}-up)`} />
          <path d={geo.line} fill="none" className="stroke-under" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" clipPath={`url(#${id}-down)`} />

          {/* End marker with a surface ring. */}
          {hover === null && <circle cx={geo.x(last)} cy={geo.y(end)} r={4.5} className={`${fill(end)} stroke-panel`} strokeWidth={2} />}

          {p && hover !== null && (
            <g>
              <line x1={geo.x(hover)} x2={geo.x(hover)} y1={PAD.top} y2={bottom} className="stroke-muted/50" strokeWidth={1} />
              <circle cx={geo.x(hover)} cy={geo.y(p.cumulative)} r={5} className={`${fill(p.cumulative)} stroke-panel`} strokeWidth={2} />
            </g>
          )}
        </svg>

        {p && hover !== null && (
          <div
            className="pointer-events-none absolute z-10 min-w-40 rounded-xl border border-line bg-panel-2/95 px-3 py-2 text-xs shadow-xl shadow-black/40 backdrop-blur"
            style={{
              top: Math.min(HEIGHT - 92, Math.max(4, geo.y(p.cumulative) - 46)),
              ...(geo.x(hover) > width / 2 ? { right: width - geo.x(hover) + 14 } : { left: geo.x(hover) + 14 }),
            }}
          >
            <p className="font-semibold text-text">{DateTime.fromISO(p.day).toFormat("ccc d LLL")}</p>
            <p className="mt-1 flex items-center gap-1.5">
              <span className={`h-0.5 w-3 rounded-full ${key(p.cumulative)}`} aria-hidden="true" />
              <span className="tabular text-sm font-semibold text-text">{formatUnits(p.cumulative)}</span>
              <span className="tabular text-muted">{formatMoney(p.cumulative, unitSize, currency)}</span>
              <span className="text-muted">total</span>
            </p>
            <p className="mt-0.5 pl-[18px] text-muted">
              <span className="tabular text-text">{p.bets ? formatUnits(p.profit) : "–"}</span>
              {p.bets > 0 && <span className="tabular"> {formatMoney(p.profit, unitSize, currency)}</span>} that day
              {p.bets ? ` · ${p.bets} bet${p.bets === 1 ? "" : "s"}` : ""}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
