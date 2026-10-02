"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, BellRing, CheckCheck, CheckCircle2, Pencil, RotateCcw, Trash2 } from "lucide-react";
import type { MatchDTO } from "@/lib/types";
import { api } from "@/lib/client-api";
import { formatDateTime, formatDayLabel, formatPct, formatReminder, formatTime } from "@/lib/format";
import { Countdown, EdgeIndicator, PercentBar, SelectionBadge, StatusBadge } from "./MatchBits";
import { MatchEditor, type MatchFormValues } from "./MatchEditor";
import { useSettings } from "./SettingsProvider";
import { useNow } from "./useNow";
import { useNotifications } from "./NotificationProvider";
import { BetPanel, PlayTypeChip } from "./BetBits";
import { MatchNames } from "./MatchNames";
import { ScreenshotViewer } from "./ScreenshotViewer";

export function MatchDetail({ initial }: { initial: MatchDTO }) {
  const { settings } = useSettings();
  const { notify } = useNotifications();
  const router = useRouter();
  const params = useSearchParams();
  const [match, setMatch] = useState(initial);
  const [editing, setEditing] = useState(params.get("edit") === "1");
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  const now = useNow();
  const tz = settings.timezone;
  const s = match.statistics;
  const alarm = match.alarm;

  const act = async (action: "cancel" | "reactivate" | "complete" | "placed") => {
    setBusy(true);
    try {
      const res = await api<{ match: MatchDTO }>(`/api/matches/${match.id}/alarm`, { method: "POST", json: { action } });
      setMatch(res.match);
    } catch (err) {
      notify("Action failed", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const save = async (v: MatchFormValues) => {
    const res = await api<{ match: MatchDTO }>(`/api/matches/${match.id}`, { method: "PATCH", json: v });
    setMatch(res.match);
    setEditing(false);
    notify("Match updated", res.match.alarm?.status === "SCHEDULED" ? `Alarm set for ${formatTime(res.match.alarm.fireAt, tz)}.` : "");
  };

  const remove = async () => {
    if (!window.confirm(`Delete ${match.player1} vs ${match.player2} and its alarm?`)) return;
    try {
      await api(`/api/matches/${match.id}`, { method: "DELETE" });
      router.push("/");
      router.refresh();
    } catch (err) {
      notify("Delete failed", err instanceof Error ? err.message : String(err));
    }
  };

  const setPlayType = async (playType: "BOT" | "PERSONAL") => {
    if (playType === match.playType) return;
    try {
      const res = await api<{ match: MatchDTO }>(`/api/matches/${match.id}`, { method: "PATCH", json: { playType } });
      setMatch(res.match);
    } catch (err) {
      notify("Update failed", err instanceof Error ? err.message : String(err));
    }
  };

  const future = new Date(match.startsAt).getTime() > now;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3">
      <Link href="/" className="flex items-center gap-1 text-sm text-muted hover:text-text">
        <ArrowLeft className="h-4 w-4" /> Dashboard
      </Link>

      <div className="card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold leading-tight">
              <MatchNames match={match} />
            </h1>
            <p className="flex items-center gap-2 text-sm text-muted">
              <PlayTypeChip playType={match.playType} />
              {match.competition ?? "Unknown competition"}
            </p>
          </div>
          <div className="text-right">
            <Countdown target={match.startsAt} status={alarm?.status} />
            {alarm && (
              <div className="mt-1">
                <StatusBadge status={alarm.status} />
              </div>
            )}
          </div>
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="label">Starts</dt>
            <dd>
              {formatTime(match.startsAt, tz)} {formatDayLabel(match.startsAt, tz)}
            </dd>
            <dd className="text-[11px] text-muted">{formatDateTime(match.startsAt, tz)}</dd>
          </div>
          <div>
            <dt className="label">Reminder</dt>
            <dd className="flex items-center gap-1">
              <BellRing className="h-3.5 w-3.5 text-accent" />
              {alarm ? formatReminder(alarm.reminderMinutes) : "None"}
            </dd>
            {alarm && <dd className="text-[11px] text-muted">fires at {formatTime(alarm.fireAt, tz)}</dd>}
          </div>
          <div>
            <dt className="label">Selection</dt>
            <dd>
              <SelectionBadge selection={s.selection} pointsLine={s.pointsLine} />
            </dd>
          </div>
          <div>
            <dt className="label">Screenshot text</dt>
            <dd className="truncate font-mono text-xs">{match.rawTimeText ?? "—"}</dd>
          </div>
          <div className="col-span-2">
            <dt className="label">O/U statistics</dt>
            <dd className="flex items-center gap-2">
              <span className="tabular">{s.ouStats ?? "–"}</span>
              <span className="tabular">{formatPct(s.ouHitRate)}</span>
            </dd>
            <dd className="mt-1">
              <PercentBar value={s.ouHitRate} tone={s.selection === "UNDER" ? "under" : "over"} label="O/U hit rate" />
            </dd>
          </div>
          <div className="col-span-2">
            <dt className="label">Edge</dt>
            <dd>
              <EdgeIndicator edge={s.edge} />
            </dd>
            <dd className="mt-1">
              <PercentBar value={s.edge} tone="edge" label="Edge" />
            </dd>
          </div>
        </dl>

        {match.notes && <p className="mt-3 whitespace-pre-line rounded-lg bg-panel-2 p-2 text-sm">{match.notes}</p>}
        {alarm?.lastError && <p className="mt-3 rounded-lg bg-under/10 p-2 text-xs text-under">{alarm.lastError}</p>}
        {alarm?.triggeredAt && <p className="mt-2 text-xs text-muted">Notification sent {formatDateTime(alarm.triggeredAt, tz)}</p>}

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button className="btn-ghost" onClick={() => setEditing((e) => !e)}>
            <Pencil className="h-4 w-4" /> {editing ? "Close editor" : "Edit"}
          </button>
          {alarm && (alarm.status === "SCHEDULED" || alarm.status === "SENDING" || alarm.status === "TRIGGERED") && (
            <button className="btn-ghost border-over/40 text-over hover:bg-over/10" disabled={busy} onClick={() => void act("placed")}>
              <CheckCircle2 className="h-4 w-4" /> Bet placed
            </button>
          )}
          {alarm && (alarm.status === "CANCELLED" || alarm.status === "FAILED") && future && (
            <button className="btn-ghost" disabled={busy} onClick={() => void act("reactivate")}>
              <RotateCcw className="h-4 w-4" /> Reactivate
            </button>
          )}
          {alarm && (alarm.status === "TRIGGERED" || alarm.status === "FAILED") && (
            <button className="btn-ghost" disabled={busy} onClick={() => void act("complete")}>
              <CheckCheck className="h-4 w-4" /> Mark completed
            </button>
          )}
          <button className="btn-danger" onClick={() => void remove()}>
            <Trash2 className="h-4 w-4" /> Delete
          </button>
        </div>
      </div>

      <div className="card flex flex-col gap-2 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Bet & profit</h2>
          <div className="flex rounded-lg border border-line p-0.5 text-xs" role="radiogroup" aria-label="Play type">
            {(["BOT", "PERSONAL"] as const).map((t) => (
              <button
                key={t}
                role="radio"
                aria-checked={match.playType === t}
                className={`rounded-md px-2.5 py-1 ${match.playType === t ? "bg-panel-2 font-semibold text-text" : "text-muted hover:text-text"}`}
                onClick={() => void setPlayType(t)}
              >
                {t === "BOT" ? "Bot play" : "Personal play"}
              </button>
            ))}
          </div>
        </div>
        <BetPanel match={match} onChange={setMatch} />
        <p className="text-[11px] text-muted">Stake and profit are in units; the money amount uses the unit size from Settings.</p>
      </div>

      {editing && (
        <div className="card p-4">
          <h2 className="mb-3 text-sm font-semibold">Edit match & reminder</h2>
          <MatchEditor initial={match} timezone={tz} defaultReminder={settings.defaultReminderMinutes} submitLabel="Save changes" onSubmit={save} onCancel={() => setEditing(false)} />
          <p className="mt-2 text-xs text-muted">Changing the start time or reminder reschedules the alarm (even if it was already sent).</p>
        </div>
      )}

      {match.screenshotIds.length > 0 && (
        <div className="card p-3">
          <h2 className="mb-2 text-sm font-semibold">Source screenshots</h2>
          <div className="flex gap-2 overflow-x-auto">
            {match.screenshotIds.map((id, i) => (
              <button key={id} type="button" onClick={() => setViewing(i)} className="shrink-0 rounded-lg focus-visible:ring-2 focus-visible:ring-accent" aria-label="Show screenshot full size">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/screenshots/${id}/image`} alt="Source screenshot" className="h-48 rounded-lg border border-line object-contain hover:border-muted" />
              </button>
            ))}
          </div>
          {viewing !== null && (
            <ScreenshotViewer ids={match.screenshotIds} start={viewing} title={`${match.player1} vs ${match.player2}`} onClose={() => setViewing(null)} />
          )}
        </div>
      )}
    </div>
  );
}
