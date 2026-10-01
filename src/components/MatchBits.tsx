"use client";

import { formatCountdown, formatPct } from "@/lib/format";
import { useNow } from "./useNow";
import type { AlarmStatus } from "@/lib/types";

export function SelectionBadge({ selection, pointsLine }: { selection: "OVER" | "UNDER" | null; pointsLine?: number | null }) {
  if (!selection) return <span className="chip bg-line/60 text-muted">NO PICK</span>;
  const over = selection === "OVER";
  return (
    <span className={`chip ${over ? "bg-over/15 text-over ring-1 ring-over/30" : "bg-under/15 text-under ring-1 ring-under/30"}`}>
      {selection}
      {pointsLine !== null && pointsLine !== undefined ? ` ${pointsLine}` : ""}
    </span>
  );
}

/** Thin progress bar for a 0-100 percentage. */
export function PercentBar({ value, tone = "accent", label }: { value: number | null; tone?: "accent" | "over" | "under" | "edge"; label?: string }) {
  const v = value === null ? 0 : Math.max(0, Math.min(100, Math.abs(value)));
  const color =
    tone === "edge"
      ? value !== null && value < 0
        ? "bg-under"
        : v >= 40
          ? "bg-over"
          : v >= 20
            ? "bg-lime-400"
            : "bg-warn"
      : tone === "over"
        ? "bg-over"
        : tone === "under"
          ? "bg-under"
          : "bg-accent";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-line" role="meter" aria-valuenow={value ?? undefined} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={`h-full rounded-full ${color} transition-[width]`} style={{ width: `${v}%` }} />
    </div>
  );
}

export function EdgeIndicator({ edge }: { edge: number | null }) {
  if (edge === null) return <span className="text-muted">–</span>;
  const tone = edge < 0 ? "text-under" : edge >= 40 ? "text-over" : edge >= 20 ? "text-lime-400" : "text-warn";
  return <span className={`font-semibold tabular ${tone}`}>{formatPct(edge)}</span>;
}

export function Countdown({ target, status }: { target: string; status?: AlarmStatus }) {
  const now = useNow();
  if (!now) return <span className="tabular text-muted">--:--</span>;
  const ms = new Date(target).getTime() - now;
  const soon = ms > 0 && ms < 10 * 60_000;
  const cls = ms <= 0 ? "text-muted" : soon ? "text-warn" : status === "CANCELLED" ? "text-muted" : "text-text";
  return <span className={`tabular font-mono text-sm font-semibold ${cls}`}>{formatCountdown(ms)}</span>;
}

const STATUS_STYLES: Record<AlarmStatus, string> = {
  SCHEDULED: "bg-accent/15 text-accent",
  SENDING: "bg-accent/15 text-accent",
  TRIGGERED: "bg-warn/15 text-warn",
  COMPLETED: "bg-line text-muted",
  CANCELLED: "bg-line text-muted line-through",
  FAILED: "bg-under/15 text-under",
};

const STATUS_LABEL: Record<AlarmStatus, string> = {
  SCHEDULED: "Scheduled",
  SENDING: "Sending",
  TRIGGERED: "Notified",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  FAILED: "Failed",
};

export function StatusBadge({ status }: { status: AlarmStatus }) {
  return <span className={`chip ${STATUS_STYLES[status]}`}>{STATUS_LABEL[status]}</span>;
}
