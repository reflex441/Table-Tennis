"use client";

import { useState } from "react";
import { Loader2, Save } from "lucide-react";
import type { MatchDTO } from "@/lib/types";
import { ReminderPicker } from "./ReminderPicker";
import { fromLocalInputValue, toLocalInputValue } from "@/lib/format";
import type { Selection } from "@/lib/selection";
import { DateTimeInput } from "./DateTimeInput";
import { LeagueSelect } from "./LeagueSelect";

export interface MatchFormValues {
  player1: string;
  player2: string;
  competition: string | null;
  startsAt: string;
  timezone: string;
  notes: string | null;
  reminderMinutes: number;
  selection: Selection | null;
  pointsLine: number | null;
  ouStats: string | null;
  ouHitRate: number | null;
  edge: number | null;
}

type Errors = Partial<Record<keyof MatchFormValues, string>>;

function parseNum(s: string, min: number, max: number): number | null | "invalid" {
  if (!s.trim()) return null;
  const n = Number(s.replace(",", ".").replace("%", ""));
  return Number.isFinite(n) && n >= min && n <= max ? n : "invalid";
}

/** Shared create/edit form for a match and its reminder. */
export function MatchEditor({
  initial,
  timezone,
  defaultReminder,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: MatchDTO;
  timezone: string;
  defaultReminder: number;
  submitLabel: string;
  onSubmit: (values: MatchFormValues) => Promise<void>;
  onCancel?: () => void;
}) {
  const [player1, setPlayer1] = useState(initial?.player1 ?? "");
  const [player2, setPlayer2] = useState(initial?.player2 ?? "");
  const [competition, setCompetition] = useState(initial?.competition ?? "");
  const [startsLocal, setStartsLocal] = useState(initial ? toLocalInputValue(initial.startsAt, timezone) : "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [reminder, setReminder] = useState(initial?.alarm?.reminderMinutes ?? defaultReminder);
  const [selection, setSelection] = useState<"" | Selection>(initial?.statistics.selection ?? "");
  const [pointsLine, setPointsLine] = useState(initial?.statistics.pointsLine?.toString() ?? "");
  const [ouStats, setOuStats] = useState(initial?.statistics.ouStats ?? "");
  const [ouHitRate, setOuHitRate] = useState(initial?.statistics.ouHitRate?.toString() ?? "");
  const [edge, setEdge] = useState(initial?.statistics.edge?.toString() ?? "");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Errors = {};
    if (!player1.trim()) errs.player1 = "Required";
    if (!player2.trim()) errs.player2 = "Required";
    const startsAt = fromLocalInputValue(startsLocal, timezone);
    if (!startsAt) errs.startsAt = "Required";
    const pl = parseNum(pointsLine, -500, 500);
    const hr = parseNum(ouHitRate, 0, 100);
    const ed = parseNum(edge, -100, 100);
    if (pl === "invalid") errs.pointsLine = "Invalid";
    if (hr === "invalid") errs.ouHitRate = "0-100";
    if (ed === "invalid") errs.edge = "-100..100";
    if (ouStats.trim() && !/^\d{1,4}\/\d{1,4}$/.test(ouStats.trim())) errs.ouStats = 'Use "20/9"';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    setFormError(null);
    try {
      await onSubmit({
        player1: player1.trim(),
        player2: player2.trim(),
        competition: competition.trim() || null,
        startsAt: startsAt!,
        timezone,
        notes: notes.trim() || null,
        reminderMinutes: reminder,
        selection: selection || null,
        pointsLine: pl as number | null,
        ouStats: ouStats.trim() || null,
        ouHitRate: hr as number | null,
        edge: ed as number | null,
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <F label="Player 1" error={errors.player1}>
          <input className="input" value={player1} onChange={(e) => setPlayer1(e.target.value)} />
        </F>
        <F label="Player 2" error={errors.player2}>
          <input className="input" value={player2} onChange={(e) => setPlayer2(e.target.value)} />
        </F>
        <F label="Competition" className="col-span-2">
          <LeagueSelect value={competition} onChange={setCompetition} />
        </F>
        <F label={`Start time (${timezone})`} error={errors.startsAt} className="col-span-2 sm:col-span-1">
          <DateTimeInput value={startsLocal} onChange={setStartsLocal} label="Start time" />
        </F>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <F label="Selection">
          <select className="input" value={selection} onChange={(e) => setSelection(e.target.value as "" | Selection)}>
            <option value="">—</option>
            <option value="OVER">OVER</option>
            <option value="UNDER">UNDER</option>
            <option value="SWEEP">SWEEP</option>
            <option value="POINTS_SPREAD">POINTS SPREAD</option>
            <option value="SET_SPREAD">SET SPREAD</option>
          </select>
        </F>
        <F label="Line" error={errors.pointsLine}>
          <input className="input" inputMode="decimal" value={pointsLine} onChange={(e) => setPointsLine(e.target.value)} />
        </F>
        <F label="O/U stats" error={errors.ouStats}>
          <input className="input" value={ouStats} onChange={(e) => setOuStats(e.target.value)} placeholder="20/9" />
        </F>
        <F label="O/U %" error={errors.ouHitRate}>
          <input className="input" inputMode="decimal" value={ouHitRate} onChange={(e) => setOuHitRate(e.target.value)} />
        </F>
        <F label="EDGE %" error={errors.edge}>
          <input className="input" inputMode="decimal" value={edge} onChange={(e) => setEdge(e.target.value)} />
        </F>
      </div>
      <div>
        <span className="label">Reminder</span>
        <ReminderPicker value={reminder} onChange={setReminder} />
      </div>
      <F label="Notes">
        <textarea className="input min-h-16" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
      </F>
      {formError && <p className="rounded-lg bg-under/10 px-3 py-2 text-sm text-under">{formError}</p>}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <button type="button" className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {submitLabel}
        </button>
      </div>
    </form>
  );
}

function F({ label, error, className = "", children }: { label: string; error?: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
      {error && <span className="mt-0.5 block text-[11px] text-under">{error}</span>}
    </label>
  );
}
