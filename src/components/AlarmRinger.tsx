"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Bell, BellRing, CheckCircle2, ExternalLink, Volume2 } from "lucide-react";
import type { MatchDTO } from "@/lib/types";
import { api } from "@/lib/client-api";
import { detectDeviceType, subscribeToPush } from "@/lib/push-client";
import { formatClock, statsLine } from "@/lib/alarms/notification-content";
import { audioUnlocked, installAudioUnlock, startSiren, unlockAudio } from "@/lib/siren";
import { formatDayLabel, formatPct, formatTime } from "@/lib/format";
import { useSettings } from "./SettingsProvider";
import { NOTIFICATION_EVENT } from "./NotificationProvider";
import { Countdown, SelectionBadge } from "./MatchBits";
import { LegsEditor, PlayTypeChip, parseLegs, splitLegs, type LegDraft } from "./BetBits";
import { MatchNames } from "./MatchNames";
import { findLeagueUrl } from "@/lib/leagues";
import { defaultStake, formatMoney, round2 } from "@/lib/bets/profit";
import { desktopApp } from "@/lib/desktop-bridge";

/**
 * Backstop poll. New alarms are picked up straight away through the
 * notifications poll (NOTIFICATION_EVENT), so this can be slow.
 */
const POLL_MS = 30_000;
const noopSubscribe = () => () => {};

/**
 * Computer-only alarm: when a reminder fires, show a full-screen alert and
 * play a continuous siren until the user confirms the bet (or skips it).
 * Phones only get the single normal notification.
 */
export function AlarmRinger() {
  const pathname = usePathname();
  const { settings } = useSettings();
  const isDesktop = useSyncExternalStore(noopSubscribe, () => detectDeviceType() === "desktop", () => false);
  const [ringing, setRinging] = useState<MatchDTO[]>([]);
  const [busy, setBusy] = useState(false);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  // Stake (units) / odds typed for the alarm on screen, keyed by match.
  const [betInput, setBetInput] = useState<{ matchId: string; stake: string; odds: string; legs: LegDraft[] | null } | null>(null);
  const [betError, setBetError] = useState<string | null>(null);
  const enabled = isDesktop && settings.ringUntilAck && pathname !== "/login";

  const refresh = useCallback(async () => {
    try {
      const res = await api<{ matches: MatchDTO[] }>("/api/alarms/ringing");
      setRinging(res.matches);
    } catch {
      /* offline - keep current state */
    }
  }, []);

  // Poll for ringing alarms; pushes and confirmations elsewhere trigger an
  // immediate refresh via service-worker messages.
  useEffect(() => {
    if (!enabled) return;
    installAudioUnlock();
    const first = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), POLL_MS);
    // The in-app notification is written just before the alarm is marked
    // triggered, so check again shortly after.
    let followUp: ReturnType<typeof setTimeout> | undefined;
    const onEvent = () => {
      void refresh();
      clearTimeout(followUp);
      followUp = setTimeout(() => void refresh(), 4000);
    };
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "push-received" || e.data?.type === "alarm-acknowledged") void refresh();
    };
    window.addEventListener(NOTIFICATION_EVENT, onEvent);
    navigator.serviceWorker?.addEventListener("message", onMessage);
    document.addEventListener("visibilitychange", onEvent);
    return () => {
      clearTimeout(first);
      clearTimeout(followUp);
      clearInterval(timer);
      window.removeEventListener(NOTIFICATION_EVENT, onEvent);
      navigator.serviceWorker?.removeEventListener("message", onMessage);
      document.removeEventListener("visibilitychange", onEvent);
    };
  }, [enabled, refresh]);

  const active = enabled && ringing.length > 0;

  // System notification (the pop-up at the side of the screen) so the alarm
  // is visible while other apps are in front. Shown from this tab when the
  // alarm starts; if this browser has no push subscription it is re-shown on
  // the repeat interval (otherwise the server's repeated pushes do that).
  const [canNotify, setCanNotify] = useState<boolean | null>(null);
  const shownRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const alarmText = (m: MatchDTO) => {
      const mins = Math.max(0, Math.round((new Date(m.startsAt).getTime() - Date.now()) / 60_000));
      const lines = [[m.competition, `${formatClock(new Date(m.startsAt), settings.timezone)} (starts in ${mins} min)`].filter(Boolean).join(" - ")];
      const stats = settings.includeStatsInNotification ? statsLine(m.statistics) : null;
      if (stats) lines.push(stats);
      lines.push("Place your bet, then click \"Bet placed\"");
      return { title: `⏰ ${m.player1} vs ${m.player2}`, body: lines.join("\n") };
    };
    const show = async () => {
      // Desktop app: one native notification per alarm and the window comes to the front.
      const bridge = desktopApp();
      if (bridge) {
        if (!cancelled) setCanNotify(true);
        for (const m of ringing) {
          if (!m.alarm || shownRef.current.has(m.alarm.id)) continue;
          shownRef.current.set(m.alarm.id, Date.now());
          bridge.alarm({ ...alarmText(m), url: `/matches/${m.id}` });
        }
        return;
      }
      const supported = typeof Notification !== "undefined" && "serviceWorker" in navigator;
      const granted = supported && Notification.permission === "granted";
      if (!cancelled) setCanNotify(granted);
      if (!granted) return;
      const reg = await navigator.serviceWorker.getRegistration("/");
      if (!reg || cancelled) return;
      const hasPush = Boolean(await reg.pushManager.getSubscription().catch(() => null));
      for (const m of ringing) {
        if (!m.alarm) continue;
        const last = shownRef.current.get(m.alarm.id);
        if (last && (hasPush || Date.now() - last < settings.repeatSeconds * 1000)) continue;
        shownRef.current.set(m.alarm.id, Date.now());
        const { title, body } = alarmText(m);
        await reg
          .showNotification(title, {
            body,
            tag: `alarm-${m.alarm.id}`,
            icon: "/icons/icon-192.png",
            badge: "/icons/badge-72.png",
            requireInteraction: true,
            renotify: Boolean(last),
            actions: [
              { action: "placed", title: "✅ Bet placed" },
              { action: "skip", title: "Skip" },
            ],
            data: { url: `/matches/${m.id}`, matchId: m.id, alarmId: m.alarm.id },
          } as NotificationOptions)
          .catch(() => {});
      }
    };
    void show();
    const timer = setInterval(() => void show(), 5_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active, ringing, settings.repeatSeconds, settings.timezone, settings.includeStatsInNotification]);
  const soundOn = active && settings.soundEnabled;
  const alarmVolume = settings.alarmVolume;
  const alarmSound = settings.alarmSound;

  // Siren: runs continuously while anything is ringing.
  useEffect(() => {
    if (!soundOn) return;
    let cancelled = false;
    const tryStart = async () => {
      const ok = audioUnlocked() || (await unlockAudio());
      if (cancelled) return;
      setSoundBlocked(!ok);
      if (ok && !stopRef.current) stopRef.current = startSiren(alarmVolume, alarmSound);
    };
    void tryStart();
    const retry = setInterval(() => {
      if (!stopRef.current) void tryStart();
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(retry);
      stopRef.current?.();
      stopRef.current = null;
    };
  }, [soundOn, alarmVolume, alarmSound]);

  // Flash the tab title so the alarm is visible from other tabs.
  useEffect(() => {
    if (!active) return;
    const original = document.title;
    let on = false;
    const timer = setInterval(() => {
      on = !on;
      document.title = on ? "⏰ PLACE YOUR BET!" : original;
    }, 900);
    return () => {
      clearInterval(timer);
      document.title = original;
    };
  }, [active]);

  if (!active) return null;
  const match = ringing[0];
  const s = match.statistics;
  const tz = settings.timezone;
  const leagueUrl = findLeagueUrl(match.competition, settings.leagueLinks);

  const input =
    betInput?.matchId === match.id
      ? betInput
      : { matchId: match.id, stake: String(defaultStake(match.stakeUnits)), odds: match.odds ? String(match.odds) : "", legs: null };
  const stakeNum = Number(input.stake);

  const ack = async (action: "placed" | "skipped") => {
    if (!match.alarm) return;
    let bet: { stake?: number; odds?: number | null; legs?: ReturnType<typeof parseLegs> } = {};
    if (action === "placed" && input.legs) {
      const legs = parseLegs(input.legs);
      if (typeof legs === "string") return setBetError(legs);
      bet = { legs };
    } else if (action === "placed") {
      const odds = input.odds.trim() ? Number(input.odds) : null;
      if (!Number.isFinite(stakeNum) || stakeNum <= 0) return setBetError("Stake must be a number of units above 0.");
      if (odds !== null && (!Number.isFinite(odds) || odds <= 1)) return setBetError("Odds must be decimal odds above 1.00 (e.g. 1.85).");
      bet = { stake: stakeNum, odds };
    }
    setBetError(null);
    setBusy(true);
    try {
      await api(`/api/alarms/${match.alarm.id}/ack`, { method: "POST", json: { action, ...bet } });
      // Remove the side notification for this alarm too.
      const reg = await navigator.serviceWorker?.getRegistration("/");
      (await reg?.getNotifications({ tag: `alarm-${match.alarm.id}` }))?.forEach((n) => n.close());
      setRinging((prev) => prev.filter((m) => m.id !== match.id));
      void refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/80 p-4 backdrop-blur-sm" role="alertdialog" aria-modal="true" aria-labelledby="alarm-title">
      <div className="card w-full max-w-lg border-2 border-under bg-panel-2 p-6 shadow-2xl shadow-under/30">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 animate-bounce place-items-center rounded-full bg-under/20 text-under">
            <BellRing className="h-7 w-7" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-widest text-under">Place your bet</p>
            <h2 id="alarm-title" className="truncate text-xl font-bold">
              <MatchNames match={match} />
            </h2>
            <p className="flex items-center gap-1.5 text-sm text-muted">
              <PlayTypeChip playType={match.playType} />
              <span className="truncate">{match.competition ?? "Unknown competition"}</span>
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-bg/60 p-3 text-sm">
          <div>
            <p className="label">Starts</p>
            <p className="font-semibold">
              {formatTime(match.startsAt, tz)} {formatDayLabel(match.startsAt, tz)}
            </p>
          </div>
          <div className="text-right">
            <p className="label">Starts in</p>
            <Countdown target={match.startsAt} />
          </div>
          <div className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <SelectionBadge selection={s.selection} pointsLine={s.pointsLine} />
            <span className="text-muted">
              O/U: <span className="text-text">{s.ouStats ?? "–"}</span>
              {s.ouHitRate !== null && <span className="text-text"> - {formatPct(s.ouHitRate)}</span>}
            </span>
            <span className="text-muted">
              EDGE: <span className="font-semibold text-text">{formatPct(s.edge)}</span>
            </span>
          </div>
        </div>

        {canNotify === false && (
          <button
            className="btn-ghost mt-3 w-full border-accent/50 text-accent"
            onClick={() => void subscribeToPush().then(() => setCanNotify(true)).catch(() => setCanNotify(false))}
          >
            <Bell className="h-4 w-4" /> Also show alerts on top of other apps (turn on notifications)
          </button>
        )}

        {soundBlocked && settings.soundEnabled && (
          <button className="btn-ghost mt-3 w-full border-warn/50 text-warn" onClick={() => void unlockAudio().then((ok) => setSoundBlocked(!ok))}>
            <Volume2 className="h-4 w-4" /> Your browser blocked the alarm sound - click to turn it on
          </button>
        )}

        {input.legs ? (
          <div className="mt-4 rounded-xl bg-bg/60 p-3">
            <LegsEditor legs={input.legs} onChange={(legs) => setBetInput({ ...input, legs })} />
            <button
              className="mt-1 text-xs text-muted underline hover:text-text"
              onClick={() => {
                const total = input.legs!.reduce((sum, l) => sum + (Number(l.stake) || 0), 0);
                setBetInput({ ...input, stake: total > 0 ? String(round2(total)) : input.stake, legs: null });
              }}
            >
              Don&apos;t split - one pick
            </button>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3">
            <label>
              <span className="label">Stake (units)</span>
              <input
                className="input tabular"
                inputMode="decimal"
                value={input.stake}
                onChange={(e) => setBetInput({ ...input, stake: e.target.value })}
                aria-label="Stake in units"
              />
              {Number.isFinite(stakeNum) && stakeNum > 0 && (
                <span className="mt-0.5 block text-[11px] text-muted">= {formatMoney(stakeNum, settings.unitSize, settings.currency, false)}</span>
              )}
            </label>
            <label>
              <span className="label">Odds (optional)</span>
              <input
                className="input tabular"
                inputMode="decimal"
                placeholder="1.85"
                value={input.odds}
                onChange={(e) => setBetInput({ ...input, odds: e.target.value })}
                aria-label="Decimal odds"
              />
            </label>
            <button
              className="col-span-2 justify-self-start text-xs text-accent hover:underline"
              onClick={() =>
                setBetInput({ ...input, legs: splitLegs(stakeNum > 0 ? stakeNum : defaultStake(match.stakeUnits), match.statistics.selection ?? "UNDER", input.odds) })
              }
            >
              Split between picks (e.g. half Under, half Sweep)
            </button>
          </div>
        )}
        {betError && <p className="mt-1 text-xs text-under">{betError}</p>}

        {leagueUrl && (
          <a href={leagueUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost mt-3 w-full border-accent/50 py-2 text-accent">
            <ExternalLink className="h-4 w-4" /> Open {match.competition} on the bookmaker
          </a>
        )}

        <button
          className="btn mt-3 w-full bg-over py-3 text-base font-bold text-slate-950 hover:bg-emerald-400"
          disabled={busy}
          onClick={() => void ack("placed")}
          autoFocus
        >
          <CheckCircle2 className="h-5 w-5" /> I&apos;ve placed the bet
        </button>
        <div className="mt-2 flex items-center justify-between text-xs text-muted">
          <button className="underline hover:text-text" disabled={busy} onClick={() => void ack("skipped")}>
            Skip this match
          </button>
          {ringing.length > 1 && <span>{ringing.length - 1} more alarm(s) waiting</span>}
        </div>
      </div>
    </div>
  );
}
