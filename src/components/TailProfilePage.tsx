"use client";

import { useState } from "react";
import { Check, Copy, Eye, Loader2 } from "lucide-react";
import type { TailMatch, TailProfile } from "@/lib/tailing";
import { api } from "@/lib/client-api";
import { formatDayLabel, formatPct, formatTime } from "@/lib/format";
import { Avatar } from "./Avatar";
import { PlayTypeChip } from "./BetBits";
import { EdgeIndicator, SelectionBadge } from "./MatchBits";
import { ProfitPage } from "./ProfitPage";
import { useSettings } from "./SettingsProvider";
import { useNotifications } from "./NotificationProvider";

/**
 * The Tailing page: the tailed account's upcoming bets (copy them to your
 * dashboard) and their profit page. The account owner sees a preview.
 */
export function TailProfilePage({ initial }: { initial: TailProfile }) {
  const { settings, update } = useSettings();
  const { notify } = useNotifications();
  const [profile, setProfile] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const { account, isSelf } = profile;
  const tz = settings.timezone;
  // Only tail bot (or personal) plays: saved to your account, so it's the same on every device.
  const only = settings.tailPlayType;
  const upcoming = only ? profile.upcoming.filter((m) => m.playType === only) : profile.upcoming;
  const notCopied = upcoming.filter((m) => !m.copied);

  const copy = async (ids: string[] | null, busyKey = ids?.[0] ?? "all") => {
    setBusy(busyKey);
    try {
      const res = await api<{ copied: number; skipped: { id: string; reason: string }[] }>("/api/tailing/copy", {
        method: "POST",
        json: ids ? { matchIds: ids } : {},
      });
      const fresh = await api<{ profile: TailProfile | null }>("/api/tailing");
      if (fresh.profile) setProfile(fresh.profile);
      notify(
        res.copied ? `Copied ${res.copied} bet${res.copied === 1 ? "" : "s"} to your dashboard` : "Nothing new to copy",
        res.skipped.length ? res.skipped.map((s) => s.reason).filter((r, i, a) => a.indexOf(r) === i).join(" ") : "",
        res.copied ? "/" : "",
      );
    } catch (err) {
      notify("Copy failed", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {isSelf && (
        <p className="flex items-start gap-2 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-accent">
          <Eye className="mt-0.5 h-4 w-4 shrink-0" />
          This is your tailing page. Every other account sees your profit and upcoming bets here and can copy them to their dashboard.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Avatar name={account.name} url={account.avatarUrl} size={56} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Tailing</p>
          <h1 className="truncate text-xl font-semibold tracking-tight">{account.name}</h1>
          <p className="text-sm text-muted">
            {account.summary.bets} bet{account.summary.bets === 1 ? "" : "s"} · {profile.upcoming.length} upcoming
          </p>
        </div>
      </div>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
          <h2 className="text-sm font-semibold">
            Upcoming bets <span className="font-normal text-muted">({upcoming.length})</span>
          </h2>
          <div className="flex rounded-lg border border-line p-0.5 text-xs" role="radiogroup" aria-label="Plays to tail">
            {(
              [
                [null, "All plays"],
                ["BOT", "Bot only"],
                ["PERSONAL", "Personal only"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={only === value}
                className={`rounded-md px-2.5 py-1 ${only === value ? "bg-panel-2 font-semibold text-text" : "text-muted hover:text-text"}`}
                onClick={() => void update({ tailPlayType: value }).catch(() => {})}
              >
                {label}
              </button>
            ))}
          </div>
          {upcoming.length > 0 && !isSelf && (
            <button
              type="button"
              className="btn-primary ml-auto px-3 py-1 text-xs"
              disabled={busy !== null || notCopied.length === 0}
              onClick={() => void copy(only ? notCopied.map((m) => m.id) : null, "all")}
            >
              {busy === "all" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
              {notCopied.length ? `Copy bets (${notCopied.length})` : "All copied"}
            </button>
          )}
        </div>
        {upcoming.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted">
            {only && profile.upcoming.length ? `No upcoming ${only === "BOT" ? "bot" : "personal"} plays right now.` : "No upcoming bets right now."}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {upcoming.map((m) => (
              <TailMatchRow key={m.id} match={m} tz={tz} busy={busy === m.id} disabled={busy !== null} onCopy={isSelf ? null : () => void copy([m.id])} />
            ))}
          </ul>
        )}
        {!isSelf && (
        <p className="border-t border-line px-3 py-2 text-[11px] text-muted">
          Copied bets go on your dashboard with your own reminder ({settings.defaultReminderMinutes} min), the same units as the play and{" "}
          {settings.useAverageOdds ? `your average odds (${settings.averageOdds.toFixed(2)})` : "their odds"}. You can edit them afterwards.
        </p>
        )}
      </section>

      <ProfitPage initial={profile.bets} title={`${account.name}'s profit`} readOnly />
    </div>
  );
}

function TailMatchRow({ match, tz, busy, disabled, onCopy }: { match: TailMatch; tz: string; busy: boolean; disabled: boolean; onCopy: (() => void) | null }) {
  const s = match.statistics;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
      <span className="w-24 shrink-0 text-xs">
        <span className="block font-medium tabular">{formatTime(match.startsAt, tz)}</span>
        <span className="block text-muted">{formatDayLabel(match.startsAt, tz)}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">
          {match.player1} <span className="font-normal text-muted">vs</span> {match.player2}
        </span>
        <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <PlayTypeChip playType={match.playType} />
          {match.competition ?? "Unknown competition"}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-2 text-xs">
        <span className="chip bg-panel-2 font-semibold tabular text-text" title="Units for this play">
          {match.stakeUnits}U
        </span>
        <SelectionBadge selection={s.selection} pointsLine={s.pointsLine} />
        <span className="text-muted">
          O/U <span className="tabular text-text">{s.ouStats ?? "–"}</span>
          {s.ouHitRate !== null && <span className="tabular text-text"> {formatPct(s.ouHitRate)}</span>}
        </span>
        <span className="text-muted">
          EDGE <EdgeIndicator edge={s.edge} />
        </span>
      </span>
      {!onCopy ? null : match.copied ? (
        <span className="chip gap-1 bg-over/15 text-over">
          <Check className="h-3 w-3" /> On your dashboard
        </span>
      ) : (
        <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={disabled} onClick={onCopy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />} Copy
        </button>
      )}
    </li>
  );
}
