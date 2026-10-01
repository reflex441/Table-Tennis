"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, Info, Trash2, XCircle } from "lucide-react";
import type { Candidate, CandidateValidation } from "@/lib/review/candidate";
import { ReminderPicker } from "@/components/ReminderPicker";
import { fromLocalInputValue, formatDayLabel, formatTime } from "@/lib/format";

interface Props {
  candidate: Candidate;
  validation: CandidateValidation;
  timezone: string;
  index: number;
  mergeTargets: { id: string; label: string }[];
  onChange: (patch: Partial<Candidate>) => void;
  onRemove: () => void;
  onMergeInto: (targetId: string) => void;
  showErrors: boolean;
}

export function CandidateForm({ candidate: c, validation, timezone, index, mergeTargets, onChange, onRemove, onMergeInto, showErrors }: Props) {
  const err = showErrors ? validation.errors : {};
  const iso = fromLocalInputValue(c.startsAtLocal, timezone);
  const created = c.result?.status === "created";
  const timeTone =
    c.timeStatus === "resolved" || c.timeStatus === "manual" || c.timeConfirmed ? "border-line" : c.timeStatus === "missing" ? "border-under/60" : "border-warn/60";

  if (created) {
    return (
      <div className="card flex items-center gap-2 border-over/40 bg-over/5 p-3 text-sm">
        <CheckCircle2 className="h-4 w-4 text-over" />
        <span className="flex-1">
          Alarm created: <b>{c.player1} vs {c.player2}</b>
          {c.result?.message ? <span className="text-muted"> — {c.result.message}</span> : null}
        </span>
        {c.result?.matchId && (
          <Link className="text-xs text-accent hover:underline" href={`/matches/${c.result.matchId}`}>
            View
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className={`card p-3 ${c.include ? "" : "opacity-60"}`}>
      <div className="mb-2 flex items-center gap-2">
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" className="h-4 w-4 accent-sky-400" checked={c.include} onChange={(e) => onChange({ include: e.target.checked })} />
          Match {index + 1}
        </label>
        {c.confidence !== null && (
          <span className={`chip ${c.confidence >= 0.8 ? "bg-over/10 text-over" : c.confidence >= 0.5 ? "bg-warn/10 text-warn" : "bg-under/10 text-under"}`}>
            {Math.round(c.confidence * 100)}% confidence
          </span>
        )}
        {c.screenshotIds.length > 1 && <span className="chip bg-accent/10 text-accent">combined from {c.screenshotIds.length} screenshots</span>}
        <div className="ml-auto flex items-center gap-1">
          {mergeTargets.length > 0 && (
            <select
              className="input w-auto py-1 text-xs"
              value=""
              aria-label="Combine with another match"
              onChange={(e) => e.target.value && onMergeInto(e.target.value)}
            >
              <option value="">Combine with…</option>
              {mergeTargets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          )}
          <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={onRemove} aria-label="Remove match">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {c.result && c.result.status !== "created" && (
        <div className={`mb-2 flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs ${c.result.status === "similar" ? "bg-warn/10 text-warn" : "bg-under/10 text-under"}`}>
          {c.result.status === "similar" ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
          <span className="flex-1">{c.result.message}</span>
          {c.result.matchId && (
            <Link className="underline" href={`/matches/${c.result.matchId}`}>
              existing
            </Link>
          )}
          {c.result.status === "similar" && (
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={c.allowSimilar} onChange={(e) => onChange({ allowSimilar: e.target.checked })} />
              Create anyway
            </label>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Field label="Player 1" error={err.player1}>
          <input className="input" value={c.player1} onChange={(e) => onChange({ player1: e.target.value })} placeholder="e.g. Varcl J" />
        </Field>
        <Field label="Player 2" error={err.player2}>
          <input className="input" value={c.player2} onChange={(e) => onChange({ player2: e.target.value })} placeholder="e.g. Jan S" />
        </Field>
        <Field label="Competition" className="col-span-2">
          <input className="input" value={c.competition} onChange={(e) => onChange({ competition: e.target.value })} placeholder="e.g. Czech Liga Pro" />
        </Field>
      </div>

      <div className={`mt-2 rounded-lg border ${timeTone} bg-bg/40 p-2`}>
        <div className="flex flex-wrap items-end gap-2">
          <Field label={`Start time (${timezone})`} error={err.startsAt} className="min-w-[13rem] flex-1">
            <input
              type="datetime-local"
              className="input"
              value={c.startsAtLocal}
              onChange={(e) => onChange({ startsAtLocal: e.target.value, timeStatus: "manual", timeConfirmed: true, timeIssues: [] })}
            />
          </Field>
          {iso && (
            <p className="pb-2 text-xs text-muted">
              {formatTime(iso, timezone)} {formatDayLabel(iso, timezone)}
            </p>
          )}
        </div>
        {(c.timeText || c.dateText) && (
          <p className="mt-1 text-xs text-muted">
            Screenshot says: <span className="font-mono text-text">“{[c.dateText, c.timeText].filter(Boolean).join(" ")}”</span>
          </p>
        )}
        {c.timeIssues.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {c.timeIssues.map((i) => (
              <li key={i} className="flex gap-1 text-xs text-warn">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {i}
              </li>
            ))}
          </ul>
        )}
        {c.timeNotes.map((n) => (
          <p key={n} className="flex gap-1 text-[11px] text-muted">
            <Info className="mt-0.5 h-3 w-3 shrink-0" /> {n}
          </p>
        ))}
        {c.timeStatus === "needs_confirmation" && c.startsAtLocal && (
          <label className={`mt-1.5 flex items-center gap-2 text-xs ${err.time ? "text-under" : "text-text"}`}>
            <input type="checkbox" checked={c.timeConfirmed} onChange={(e) => onChange({ timeConfirmed: e.target.checked })} />I checked this start time is correct
          </label>
        )}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Field label="Selection">
          <select
            className={`input ${c.selection === "OVER" ? "text-over" : c.selection === "UNDER" ? "text-under" : ""}`}
            value={c.selection}
            onChange={(e) => onChange({ selection: e.target.value as Candidate["selection"] })}
          >
            <option value="">—</option>
            <option value="OVER">OVER</option>
            <option value="UNDER">UNDER</option>
          </select>
        </Field>
        <Field label="Line" error={err.pointsLine}>
          <input className="input" inputMode="decimal" value={c.pointsLine} onChange={(e) => onChange({ pointsLine: e.target.value })} placeholder="74.5" />
        </Field>
        <Field label="O/U stats" error={err.ouStats}>
          <input className="input" value={c.ouStats} onChange={(e) => onChange({ ouStats: e.target.value })} placeholder="20/9" />
        </Field>
        <Field label="O/U %" error={err.ouHitRate}>
          <input className="input" inputMode="decimal" value={c.ouHitRate} onChange={(e) => onChange({ ouHitRate: e.target.value })} placeholder="69" />
        </Field>
        <Field label="EDGE %" error={err.edge}>
          <input className="input" inputMode="decimal" value={c.edge} onChange={(e) => onChange({ edge: e.target.value })} placeholder="47" />
        </Field>
      </div>

      {c.conflicts.length > 0 && (
        <div className="mt-2 rounded-lg bg-warn/10 p-2 text-xs text-warn">
          <p className="font-semibold">Screenshots disagree — please check:</p>
          <ul className="mt-1 space-y-1">
            {c.conflicts.map((cf, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <span>
                  {cf.field}: kept <b>{cf.kept}</b>, other screenshot shows <b>{cf.other}</b>
                </span>
                <button
                  type="button"
                  className="underline"
                  onClick={() =>
                    onChange({
                      [cf.field]: cf.other,
                      conflicts: c.conflicts.filter((_, j) => j !== i),
                    } as Partial<Candidate>)
                  }
                >
                  use {cf.other}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-2">
        <span className="label">Reminder</span>
        <ReminderPicker value={c.reminderMinutes} onChange={(m) => onChange({ reminderMinutes: m })} />
      </div>
    </div>
  );
}

function Field({ label, error, className = "", children }: { label: string; error?: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
      {error && <span className="mt-0.5 block text-[11px] text-under">{error}</span>}
    </label>
  );
}
