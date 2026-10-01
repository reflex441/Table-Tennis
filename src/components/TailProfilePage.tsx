"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Check, Copy, Loader2 } from "lucide-react";
import type { TailMatch, TailProfile } from "@/lib/tailing";
import { api } from "@/lib/client-api";
import { formatDayLabel, formatPct, formatTime } from "@/lib/format";
import { Avatar } from "./Avatar";
import { PlayTypeChip } from "./BetBits";
import { EdgeIndicator, SelectionBadge } from "./MatchBits";
import { ProfitPage } from "./ProfitPage";
import { TailButton } from "./TailAccountCard";
import { useSettings } from "./SettingsProvider";
import { useNotifications } from "./NotificationProvider";

/** A tailed account: their upcoming bets (copy to your dashboard) and their profit page. */
export function TailProfilePage({ initial }: { initial: TailProfile }) {
  const { settings } = useSettings();
  const { notify } = useNotifications();
  const [profile, setProfile] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const { account, upcoming } = profile;
  const tz = settings.timezone;
  const notCopied = upcoming.filter((m) => !m.copied);

  const copy = async (ids: string[] | null) => {
    setBusy(ids?.[0] ?? "all");
    try {
      const res = await api<{ copied: number; skipped: { id: string; reason: string }[] }>(`/api/tailing/${account.id}/copy`, {
        method: "POST",
        json: ids ? { matchIds: ids } : {},
      });
      const fresh = await api<TailProfile>(`/api/tailing/${account.id}`);
      setProfile(fresh);
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
      <Link href="/tailing" className="flex items-center gap-1 text-sm text-muted hover:text-text">
        <ArrowLeft className="h-4 w-4" /> Tailing
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <Avatar name={account.name} url={account.avatarUrl} size={56} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold tracking-tight">{account.name}</h1>
          <p className="text-sm text-muted">
            {account.summary.bets} bet{account.summary.bets === 1 ? "" : "s"} · {upcoming.length} upcoming
          </p>
        </div>
        <TailButton accountId={account.id} tailed={account.tailed} size="md" onChange={(tailed) => setProfile((p) => ({ ...p, account: { ...p.account, tailed } }))} />
      </div>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
          <h2 className="text-sm font-semibold">
            Upcoming bets <span className="font-normal text-muted">({upcoming.length})</span>
          </h2>
          {upcoming.length > 0 && (
            <button type="button" className="btn-primary px-3 py-1 text-xs" disabled={busy !== null || notCopied.length === 0} onClick={() => void copy(null)}>
              {busy === "all" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
              {notCopied.length ? `Copy bets (${notCopied.length})` : "All copied"}
            </button>
          )}
        </div>
        {upcoming.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted">No upcoming bets right now.</p>
        ) : (
          <ul className="divide-y divide-line">
            {upcoming.map((m) => (
              <TailMatchRow key={m.id} match={m} tz={tz} busy={busy === m.id} disabled={busy !== null} onCopy={() => void copy([m.id])} />
            ))}
          </ul>
        )}
        <p className="border-t border-line px-3 py-2 text-[11px] text-muted">
          Copied bets go on your dashboard with your own reminder ({settings.defaultReminderMinutes} min), a 1u stake and{" "}
          {settings.useAverageOdds ? `your average odds (${settings.averageOdds.toFixed(2)})` : "their odds"}. You can edit them afterwards.
        </p>
      </section>

      <ProfitPage initial={profile.bets} title={`${account.name}'s profit`} readOnly />
    </div>
  );
}

function TailMatchRow({ match, tz, busy, disabled, onCopy }: { match: TailMatch; tz: string; busy: boolean; disabled: boolean; onCopy: () => void }) {
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
        <SelectionBadge selection={s.selection} pointsLine={s.pointsLine} />
        <span className="text-muted">
          O/U <span className="tabular text-text">{s.ouStats ?? "–"}</span>
          {s.ouHitRate !== null && <span className="tabular text-text"> {formatPct(s.ouHitRate)}</span>}
        </span>
        <span className="text-muted">
          EDGE <EdgeIndicator edge={s.edge} />
        </span>
      </span>
      {match.copied ? (
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
