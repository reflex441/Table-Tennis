"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { BellRing, CheckCircle2, Volume2 } from "lucide-react";
import type { MatchDTO } from "@/lib/types";
import { api } from "@/lib/client-api";
import { detectDeviceType } from "@/lib/push-client";
import { audioUnlocked, installAudioUnlock, startSiren, unlockAudio } from "@/lib/siren";
import { formatDayLabel, formatPct, formatTime } from "@/lib/format";
import { useSettings } from "./SettingsProvider";
import { NOTIFICATION_EVENT } from "./NotificationProvider";
import { Countdown, SelectionBadge } from "./MatchBits";

const POLL_MS = 5_000;
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
    const onEvent = () => void refresh();
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "push-received" || e.data?.type === "alarm-acknowledged") void refresh();
    };
    window.addEventListener(NOTIFICATION_EVENT, onEvent);
    navigator.serviceWorker?.addEventListener("message", onMessage);
    document.addEventListener("visibilitychange", onEvent);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener(NOTIFICATION_EVENT, onEvent);
      navigator.serviceWorker?.removeEventListener("message", onMessage);
      document.removeEventListener("visibilitychange", onEvent);
    };
  }, [enabled, refresh]);

  const active = enabled && ringing.length > 0;
  const soundOn = active && settings.soundEnabled;

  // Siren: runs continuously while anything is ringing.
  useEffect(() => {
    if (!soundOn) return;
    let cancelled = false;
    const tryStart = async () => {
      const ok = audioUnlocked() || (await unlockAudio());
      if (cancelled) return;
      setSoundBlocked(!ok);
      if (ok && !stopRef.current) stopRef.current = startSiren();
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
  }, [soundOn]);

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

  const ack = async (action: "placed" | "skipped") => {
    if (!match.alarm) return;
    setBusy(true);
    try {
      await api(`/api/alarms/${match.alarm.id}/ack`, { method: "POST", json: { action } });
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
              {match.player1} <span className="font-normal text-muted">vs</span> {match.player2}
            </h2>
            <p className="text-sm text-muted">{match.competition ?? "Unknown competition"}</p>
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

        {soundBlocked && settings.soundEnabled && (
          <button className="btn-ghost mt-3 w-full border-warn/50 text-warn" onClick={() => void unlockAudio().then((ok) => setSoundBlocked(!ok))}>
            <Volume2 className="h-4 w-4" /> Your browser blocked the alarm sound - click to turn it on
          </button>
        )}

        <button
          className="btn mt-4 w-full bg-over py-3 text-base font-bold text-slate-950 hover:bg-emerald-400"
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
