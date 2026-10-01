"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Upload, Plus, CalendarClock, BellRing, CheckCircle2, XCircle } from "lucide-react";
import type { MatchDTO } from "@/lib/types";
import { sectionForStatus, type Section } from "@/lib/alarms/schedule";
import { api } from "@/lib/client-api";
import { MatchCard, type MatchCardActions } from "./MatchCard";
import { useSettings } from "./SettingsProvider";
import { NOTIFICATION_EVENT, useNotifications } from "./NotificationProvider";
import { PushStatusBanner } from "./PushStatusBanner";

const SECTIONS: { key: Section; label: string; icon: typeof CalendarClock; empty: string }[] = [
  { key: "upcoming", label: "Upcoming", icon: CalendarClock, empty: "No upcoming alarms. Upload a screenshot to create some." },
  { key: "triggered", label: "Triggered", icon: BellRing, empty: "Nothing has been triggered yet." },
  { key: "completed", label: "Completed", icon: CheckCircle2, empty: "No completed matches." },
  { key: "cancelled", label: "Cancelled", icon: XCircle, empty: "No cancelled alarms." },
];

export function Dashboard({ initial }: { initial: MatchDTO[] }) {
  const { settings } = useSettings();
  const { notify } = useNotifications();
  const [matches, setMatches] = useState(initial);
  const [section, setSection] = useState<Section>("upcoming");

  const reload = useCallback(async () => {
    try {
      const res = await api<{ matches: MatchDTO[] }>("/api/matches");
      setMatches(res.matches);
    } catch {
      /* keep stale data */
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => void reload(), 20_000);
    const onEvent = () => void reload();
    window.addEventListener(NOTIFICATION_EVENT, onEvent);
    return () => {
      clearInterval(timer);
      window.removeEventListener(NOTIFICATION_EVENT, onEvent);
    };
  }, [reload]);

  const grouped = useMemo(() => {
    const g: Record<Section, MatchDTO[]> = { upcoming: [], triggered: [], completed: [], cancelled: [] };
    for (const m of matches) g[sectionForStatus(m.alarm?.status ?? "SCHEDULED")].push(m);
    const asc = (a: MatchDTO, b: MatchDTO) => a.startsAt.localeCompare(b.startsAt);
    g.upcoming.sort(asc);
    g.triggered.sort(asc);
    g.completed.sort((a, b) => -asc(a, b));
    g.cancelled.sort((a, b) => -asc(a, b));
    return g;
  }, [matches]);

  const replace = (m: MatchDTO) => setMatches((prev) => prev.map((x) => (x.id === m.id ? m : x)));
  const alarmAction = (action: "cancel" | "reactivate" | "complete") => async (m: MatchDTO) => {
    try {
      const res = await api<{ match: MatchDTO }>(`/api/matches/${m.id}/alarm`, { method: "POST", json: { action } });
      replace(res.match);
    } catch (err) {
      notify("Action failed", err instanceof Error ? err.message : String(err));
    }
  };
  const actions: MatchCardActions = {
    onCancel: alarmAction("cancel"),
    onReactivate: alarmAction("reactivate"),
    onComplete: alarmAction("complete"),
    onDelete: async (m) => {
      try {
        await api(`/api/matches/${m.id}`, { method: "DELETE" });
        setMatches((prev) => prev.filter((x) => x.id !== m.id));
      } catch (err) {
        notify("Delete failed", err instanceof Error ? err.message : String(err));
      }
    },
  };

  const next = grouped.upcoming[0];
  const list = grouped[section];

  return (
    <div className="flex flex-col gap-4">
      <PushStatusBanner />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Match alarms</h1>
          <p className="text-sm text-muted">
            {grouped.upcoming.length} upcoming
            {next ? (
              <>
                {" "}
                · next: <span className="text-text">{next.player1} vs {next.player2}</span>
              </>
            ) : null}
            <span className="hidden sm:inline"> · times shown in {settings.timezone}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/matches/new" className="btn-ghost">
            <Plus className="h-4 w-4" /> Manual
          </Link>
          <Link href="/upload" className="btn-primary">
            <Upload className="h-4 w-4" /> Upload screenshots
          </Link>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-panel p-1" role="tablist">
        {SECTIONS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            role="tab"
            aria-selected={section === key}
            onClick={() => setSection(key)}
            className={`flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ${
              section === key ? "bg-panel-2 text-text shadow" : "text-muted hover:text-text"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
            <span className={`rounded-full px-1.5 text-[11px] tabular ${section === key ? "bg-accent/20 text-accent" : "bg-line text-muted"}`}>
              {grouped[key].length}
            </span>
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="card grid place-items-center gap-3 px-4 py-12 text-center">
          <p className="text-sm text-muted">{SECTIONS.find((s) => s.key === section)?.empty}</p>
          {section === "upcoming" && (
            <Link href="/upload" className="btn-primary">
              <Upload className="h-4 w-4" /> Upload screenshots
            </Link>
          )}
        </div>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((m) => (
            <MatchCard key={m.id} match={m} timezone={settings.timezone} actions={actions} />
          ))}
        </div>
      )}
    </div>
  );
}
