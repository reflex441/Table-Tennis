"use client";

import Link from "next/link";
import { useState } from "react";
import { Ban, Pencil, RotateCcw, Trash2, CheckCheck, BellRing } from "lucide-react";
import type { MatchDTO } from "@/lib/types";
import { formatDayLabel, formatPct, formatReminder, formatTime } from "@/lib/format";
import { Countdown, EdgeIndicator, PercentBar, SelectionBadge, StatusBadge } from "./MatchBits";
import { useNow } from "./useNow";

export interface MatchCardActions {
  onCancel: (m: MatchDTO) => Promise<void>;
  onReactivate: (m: MatchDTO) => Promise<void>;
  onComplete: (m: MatchDTO) => Promise<void>;
  onDelete: (m: MatchDTO) => Promise<void>;
}

export function MatchCard({ match, timezone, actions, highlight }: { match: MatchDTO; timezone: string; actions: MatchCardActions; highlight?: boolean }) {
  const [busy, setBusy] = useState(false);
  const now = useNow();
  const s = match.statistics;
  const alarm = match.alarm;
  const status = alarm?.status ?? "SCHEDULED";
  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <article
      id={`match-${match.id}`}
      className={`card group relative flex flex-col gap-1.5 p-3 transition-colors hover:border-muted/40 ${highlight ? "ring-2 ring-accent" : ""} ${status === "CANCELLED" ? "opacity-70" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/matches/${match.id}`} className="block truncate text-[15px] font-semibold leading-tight hover:underline">
            {match.player1} <span className="font-normal text-muted">vs</span> {match.player2}
          </Link>
          <p className="truncate text-xs text-muted">{match.competition ?? "Unknown competition"}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Countdown target={match.startsAt} status={status} />
          <StatusBadge status={status} />
        </div>
      </div>

      <p className="text-xs text-text/90">
        <span className="font-medium tabular">{formatTime(match.startsAt, timezone)}</span> {formatDayLabel(match.startsAt, timezone)}
        {alarm && (
          <>
            <span className="text-muted"> · </span>
            <span className="inline-flex items-center gap-1 text-muted">
              <BellRing className="h-3 w-3" /> {formatReminder(alarm.reminderMinutes)}
            </span>
          </>
        )}
      </p>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <SelectionBadge selection={s.selection} pointsLine={s.pointsLine} />
        <span className="text-line">|</span>
        <span className="text-muted">
          O/U: <span className="tabular text-text">{s.ouStats ?? "–"}</span>
          {s.ouHitRate !== null && <span className="tabular text-text"> - {formatPct(s.ouHitRate)}</span>}
        </span>
        <span className="text-line">|</span>
        <span className="text-muted">
          EDGE: <EdgeIndicator edge={s.edge} />
        </span>
      </div>

      {(s.ouHitRate !== null || s.edge !== null) && (
        <div className="grid grid-cols-2 gap-3 pt-0.5">
          <PercentBar value={s.ouHitRate} tone={s.selection === "UNDER" ? "under" : "over"} label="O/U hit rate" />
          <PercentBar value={s.edge} tone="edge" label="Edge" />
        </div>
      )}

      {alarm?.lastError && (status === "FAILED" || status === "TRIGGERED") && (
        <p className="rounded-md bg-under/10 px-2 py-1 text-[11px] text-under">{alarm.lastError}</p>
      )}

      <div className="mt-0.5 flex items-center justify-end gap-1">
        <Link href={`/matches/${match.id}?edit=1`} className="btn-ghost px-2 py-1 text-xs" aria-label="Edit">
          <Pencil className="h-3.5 w-3.5" /> Edit
        </Link>
        {(status === "SCHEDULED" || status === "SENDING") && (
          <button className="btn-ghost px-2 py-1 text-xs" disabled={busy} onClick={run(() => actions.onCancel(match))} aria-label="Cancel alarm">
            <Ban className="h-3.5 w-3.5" /> Cancel
          </button>
        )}
        {(status === "CANCELLED" || status === "FAILED") && new Date(match.startsAt).getTime() > now && (
          <button className="btn-ghost px-2 py-1 text-xs" disabled={busy} onClick={run(() => actions.onReactivate(match))}>
            <RotateCcw className="h-3.5 w-3.5" /> Reactivate
          </button>
        )}
        {(status === "TRIGGERED" || status === "FAILED") && (
          <button className="btn-ghost px-2 py-1 text-xs" disabled={busy} onClick={run(() => actions.onComplete(match))}>
            <CheckCheck className="h-3.5 w-3.5" /> Done
          </button>
        )}
        <button
          className="btn-danger px-2 py-1 text-xs"
          disabled={busy}
          aria-label="Delete"
          onClick={run(async () => {
            if (window.confirm(`Delete ${match.player1} vs ${match.player2} and its alarm?`)) await actions.onDelete(match);
          })}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </article>
  );
}
