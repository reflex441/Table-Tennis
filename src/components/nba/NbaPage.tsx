"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { Check, CircleHelp, Loader2, Pencil, Plus, RefreshCw, RotateCcw, ScanText, Trash2, X, Zap } from "lucide-react";
import { DateTime } from "luxon";
import { api } from "@/lib/client-api";
import { formatDayLabel } from "@/lib/format";
import { formatUnits, summarize, summarizeBy, type BetResult, type ProfitSummary, type Settleable } from "@/lib/bets/profit";
import { cumulativeSeries, dailyPL, dayKey } from "@/lib/bets/daily";
import { knownTipsters } from "@/lib/nba/aliases";
import { NBA_MARKET_LABEL } from "@/lib/nba/parse";
import type { NbaBetDTO } from "@/lib/nba/service";
import { ProfitAmount, ResultChip } from "../BetBits";
import { DailyCalendar } from "../DailyCalendar";
import { ProfitChart } from "../ProfitChart";
import { useSettings } from "../SettingsProvider";
import { useNotifications } from "../NotificationProvider";
import { useToday } from "../useNow";
import { BasketballIcon } from "./BasketballIcon";
import { NbaBetForm } from "./NbaBetForm";
import { NbaScanner } from "./NbaScanner";
import { NBA_TUTORIAL_EVENT, NbaTutorial } from "./NbaTutorial";
import { SummaryStats, pct } from "../SummaryStats";

/** Table tennis bets, for the combined totals. */
type TableTennisRow = Settleable & { startsAt: string };

type Status = "ALL" | "PENDING" | "SETTLED";

/**
 * NBA: tipsters' picks (scanned from screenshots or typed in), tracked in
 * units with no alarm. Separate from table tennis, with the two combined
 * at the top.
 */
export function NbaPage({ initial, tableTennis, firstVisit = false }: { initial: NbaBetDTO[]; tableTennis: TableTennisRow[]; firstVisit?: boolean }) {
  const { settings } = useSettings();
  const { notify } = useNotifications();
  const tz = settings.timezone;
  const today = useToday(tz);
  const [bets, setBets] = useState(initial);
  const [open, setOpen] = useState<null | "scan" | "add" | { edit: NbaBetDTO }>(null);
  const [tipster, setTipster] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("ALL");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [chart, setChart] = useState<"nba" | "combined">("nba");
  const [busy, setBusy] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  /** Look up pending bets on ESPN now (it also happens every 10-20 minutes by itself). */
  const checkResults = async () => {
    setChecking(true);
    try {
      const res = await api<{ report: { checked: number; settled: number; notes: { pick: string; note: string; settled: boolean }[] }; bets: NbaBetDTO[] }>(
        "/api/nba/grade",
        { method: "POST" },
      );
      setBets(res.bets);
      const { checked, settled, notes } = res.report;
      // Each bet that wasn't settled, with the reason (also shown under the bet).
      const open = notes.filter((n) => !n.settled);
      notify(
        checked ? `${settled} of ${checked} bet${checked === 1 ? "" : "s"} settled from ESPN` : "Nothing to check right now",
        checked
          ? open.slice(0, 3).map((n) => `${n.pick}: ${n.note}`).join("\n") + (open.length > 3 ? `\n+${open.length - 3} more (see the notes under each bet)` : "")
          : "Player props, moneylines, spreads and totals that haven't been settled are checked once their game date has come.",
      );
    } catch (err) {
      notify("Couldn't check results", err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  };

  const dated = useMemo(() => bets.map((b) => ({ ...b, startsAt: b.placedAt })), [bets]);
  const tipsters = useMemo(() => knownTipsters(settings.nbaTipsters, bets.map((b) => b.tipster)), [settings.nbaTipsters, bets]);
  const nba = useMemo(() => summarize(bets), [bets]);
  const tt = useMemo(() => summarize(tableTennis), [tableTennis]);
  const combined = useMemo(() => summarize([...bets, ...tableTennis]), [bets, tableTennis]);
  const byTipster = useMemo(() => summarizeBy(bets, (b) => b.tipster), [bets]);
  const byBook = useMemo(() => summarizeBy(bets, (b) => b.bookmaker ?? "Unknown bookmaker"), [bets]);

  const scoped = useMemo(() => dated.filter((b) => !tipster || b.tipster === tipster), [dated, tipster]);
  const daily = useMemo(() => dailyPL(chart === "combined" && !tipster ? [...scoped, ...tableTennis] : scoped, tz), [scoped, tableTennis, chart, tipster, tz]);
  const series = useMemo(() => {
    const keys = [...daily.keys()].sort();
    const to = today ?? keys[keys.length - 1];
    return keys[0] && to ? cumulativeSeries(daily, keys[0], to < keys[0] ? keys[0] : to) : [];
  }, [daily, today]);
  const shown = useMemo(
    () =>
      scoped.filter(
        (b) =>
          (status === "ALL" || (status === "PENDING" ? b.result === "PENDING" : b.result !== "PENDING")) &&
          (!selectedDay || dayKey(b.placedAt, tz) === selectedDay),
      ),
    [scoped, status, selectedDay, tz],
  );

  const replace = (bet: NbaBetDTO) => setBets((prev) => prev.map((b) => (b.id === bet.id ? bet : b)));
  const settle = async (bet: NbaBetDTO, result: BetResult) => {
    setBusy(bet.id);
    try {
      replace((await api<{ bet: NbaBetDTO }>(`/api/nba/bets/${bet.id}`, { method: "PATCH", json: { result } })).bet);
    } catch (err) {
      notify("Couldn't update the bet", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };
  const remove = async (bet: NbaBetDTO) => {
    if (!window.confirm(`Delete "${bet.pick}" (${bet.tipster})?`)) return;
    setBusy(bet.id);
    try {
      await api(`/api/nba/bets/${bet.id}`, { method: "DELETE" });
      setBets((prev) => prev.filter((b) => b.id !== bet.id));
    } catch (err) {
      notify("Couldn't delete the bet", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <Suspense>
        <NbaTutorial firstTime={firstVisit} />
      </Suspense>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <BasketballIcon className="h-5 w-5 text-orange-400" /> NBA
          </h1>
          <p className="text-xs text-muted">
            Tipsters&apos; picks, tracked in units · 1u = {settings.currency}
            {settings.unitSize} · separate from table tennis
          </p>
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted">
            <Zap className="h-3 w-3 text-accent" /> Player props, moneylines, spreads and totals are settled automatically from ESPN about an hour after the game ends (or press Check results).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={() => window.dispatchEvent(new Event(NBA_TUTORIAL_EVENT))} title="The NBA tutorial">
            <CircleHelp className="h-4 w-4" /> How it works
          </button>
          <button className="btn-ghost" disabled={checking} onClick={() => void checkResults()} title="Look up pending bets on ESPN now">
            {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Check results
          </button>
          <button className="btn-ghost" onClick={() => setOpen("scan")}>
            <ScanText className="h-4 w-4" /> Scan picks
          </button>
          <button className="btn-ghost" onClick={() => setOpen("add")}>
            <Plus className="h-4 w-4" /> Add bet
          </button>
        </div>
      </div>

      {open === "scan" && (
        <NbaScanner
          tipsters={tipsters}
          onClose={() => setOpen(null)}
          onAdded={(added) => {
            setBets((prev) => [...added, ...prev].sort((a, b) => b.placedAt.localeCompare(a.placedAt)));
            notify(`Added ${added.length} NBA bet${added.length === 1 ? "" : "s"}`, "");
          }}
        />
      )}
      {(open === "add" || (open && typeof open === "object")) && (
        <NbaBetForm
          key={typeof open === "object" ? open.edit.id : "add"}
          bet={typeof open === "object" ? open.edit : undefined}
          tipsters={tipsters}
          onClose={() => setOpen(null)}
          onSaved={(bet) => {
            if (typeof open === "object") replace(bet);
            else setBets((prev) => [bet, ...prev].sort((a, b) => b.placedAt.localeCompare(a.placedAt)));
            setOpen(null);
          }}
        />
      )}

      <section className="grid gap-3 sm:grid-cols-3" aria-label="NBA, table tennis and combined">
        <SummaryCard title="NBA" icon={<BasketballIcon className="h-4 w-4 text-orange-400" />} summary={nba} />
        <SummaryCard
          title="Table tennis"
          icon={<span aria-hidden="true">🏓</span>}
          summary={tt}
          action={
            <Link href="/profit" className="text-[11px] text-accent hover:underline">
              Profit page →
            </Link>
          }
        />
        <SummaryCard title="Combined" icon={<span aria-hidden="true">Σ</span>} summary={combined} />
      </section>

      <section className="card overflow-hidden">
        <h2 className="border-b border-line px-3 py-2 text-sm font-semibold">
          Tipsters <span className="font-normal text-muted">· click one to see only their picks</span>
        </h2>
        {byTipster.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted">No NBA bets yet - scan a tipster&apos;s picks or add one.</p>
        ) : (
          <SummaryTable rows={byTipster} label="Tipster" active={tipster} onSelect={(k) => setTipster(tipster === k ? null : k)} />
        )}
      </section>

      <section className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="card min-w-0 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">
              Running profit <span className="font-normal text-muted">· {tipster ?? (chart === "combined" ? "NBA + table tennis" : "all tipsters")}</span>
            </h2>
            {!tipster && (
              <span className="flex rounded-lg border border-line p-0.5 text-xs" role="radiogroup" aria-label="Graph">
                {(
                  [
                    ["nba", "NBA"],
                    ["combined", "Combined"],
                  ] as const
                ).map(([v, label]) => (
                  <button
                    key={v}
                    role="radio"
                    aria-checked={chart === v}
                    className={`rounded-md px-2.5 py-1 ${chart === v ? "bg-panel-2 font-semibold text-text" : "text-muted hover:text-text"}`}
                    onClick={() => setChart(v)}
                  >
                    {label}
                  </button>
                ))}
              </span>
            )}
          </div>
          <ProfitChart points={series} unitSize={settings.unitSize} currency={settings.currency} />
        </div>
        <div className="card min-w-0 p-3">
          <h2 className="mb-2 text-sm font-semibold">Daily P/L</h2>
          <DailyCalendar days={daily} today={today} selected={selectedDay} onSelect={setSelectedDay} unitSize={settings.unitSize} currency={settings.currency} />
        </div>
      </section>

      {byBook.length > 1 && (
        <section className="card overflow-hidden">
          <h2 className="border-b border-line px-3 py-2 text-sm font-semibold">By bookmaker</h2>
          <SummaryTable rows={byBook} label="Bookmaker" />
        </section>
      )}

      <section className="card overflow-hidden" aria-label="NBA bets">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
          <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            Bets
            {tipster && (
              <button className="chip gap-1 bg-accent/15 text-accent" onClick={() => setTipster(null)} aria-label="Show all tipsters">
                {tipster} <X className="h-3 w-3" />
              </button>
            )}
            {selectedDay && (
              <button className="chip gap-1 bg-accent/15 text-accent" onClick={() => setSelectedDay(null)} aria-label="Show all days">
                {DateTime.fromISO(selectedDay).toFormat("ccc d LLL")} <X className="h-3 w-3" />
              </button>
            )}
          </h2>
          <span className="flex rounded-lg border border-line p-0.5 text-xs" role="radiogroup" aria-label="Show">
            {(
              [
                ["ALL", "All"],
                ["PENDING", `Pending (${scoped.filter((b) => b.result === "PENDING").length})`],
                ["SETTLED", "Settled"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                role="radio"
                aria-checked={status === v}
                className={`rounded-md px-2.5 py-1 ${status === v ? "bg-panel-2 font-semibold text-text" : "text-muted hover:text-text"}`}
                onClick={() => setStatus(v)}
              >
                {label}
              </button>
            ))}
          </span>
        </div>
        {shown.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted">No bets here.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-1.5 font-medium">Game date</th>
                  <th className="px-3 py-1.5 font-medium">Pick</th>
                  <th className="px-3 py-1.5 text-right font-medium">Units</th>
                  <th className="px-3 py-1.5 text-right font-medium">Odds</th>
                  <th className="px-3 py-1.5 font-medium">Result</th>
                  <th className="px-3 py-1.5 text-right font-medium">Profit</th>
                  <th className="px-3 py-1.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.map((b) => (
                  <tr key={b.id} className="hover:bg-panel-2/60">
                    <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted">
                      {formatDayLabel(b.placedAt, tz)}
                      {b.dateKind === "POSTED" && b.result === "PENDING" && <span className="block text-[10px]">posted - next game</span>}
                    </td>
                    <td className="max-w-[22rem] px-3 py-1.5">
                      <span className="block truncate font-medium">{b.pick}</span>
                      <span className="block truncate text-[11px] text-muted">
                        <span className="text-text">{b.tipster}</span> · {NBA_MARKET_LABEL[b.market]}
                        {b.bookmaker ? ` · ${b.bookmaker}` : ""}
                        {b.game ? ` · ${b.game}` : ""}
                      </span>
                      {b.gradeNote && (b.autoGraded || b.result === "PENDING") && (
                        <span className={`flex items-center gap-1 truncate text-[11px] ${b.autoGraded ? "text-accent" : "text-muted"}`} title={b.gradeNote}>
                          {b.autoGraded && (
                            <span className="chip shrink-0 gap-0.5 bg-accent/15 px-1 py-0 text-[10px] text-accent">
                              <Zap className="h-2.5 w-2.5" /> auto
                            </span>
                          )}
                          <span className="truncate">{b.gradeNote}</span>
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular">{formatUnits(b.stake, false)}</td>
                    <td className="px-3 py-1.5 text-right tabular">{b.odds ? b.odds.toFixed(2) : <span className="text-warn">add</span>}</td>
                    <td className="whitespace-nowrap px-3 py-1.5">
                      {b.result === "PENDING" ? (
                        <span className="flex gap-1" role="group" aria-label={`Settle ${b.pick}`}>
                          <button className="btn-ghost px-2 py-0.5 text-[11px] text-over" disabled={busy === b.id} onClick={() => void settle(b, "WON")}>
                            <Check className="h-3 w-3" /> Won
                          </button>
                          <button className="btn-ghost px-2 py-0.5 text-[11px] text-under" disabled={busy === b.id} onClick={() => void settle(b, "LOST")}>
                            <X className="h-3 w-3" /> Lost
                          </button>
                          <button className="btn-ghost px-2 py-0.5 text-[11px]" disabled={busy === b.id} onClick={() => void settle(b, "VOID")}>
                            Void
                          </button>
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <ResultChip result={b.result} />
                          <button
                            className="rounded p-0.5 text-muted hover:text-text"
                            disabled={busy === b.id}
                            onClick={() => void settle(b, "PENDING")}
                            aria-label={`Mark ${b.pick} as pending`}
                            title="Back to pending"
                          >
                            <RotateCcw className="h-3 w-3" />
                          </button>
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {b.profit !== null ? (
                        <ProfitAmount units={b.profit} />
                      ) : b.result === "WON" ? (
                        <span className="text-[11px] text-warn">add odds</span>
                      ) : (
                        <span className="text-muted">–</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right">
                      <button className="rounded p-1 text-muted hover:text-text" onClick={() => setOpen({ edit: b })} aria-label={`Edit ${b.pick}`} title="Edit">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button className="rounded p-1 text-muted hover:text-under" disabled={busy === b.id} onClick={() => void remove(b)} aria-label={`Delete ${b.pick}`} title="Delete">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export function SummaryCard({ title, icon, summary, action }: { title: string; icon: React.ReactNode; summary: ProfitSummary; action?: React.ReactNode }) {
  return (
    <div className="card p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          {icon} {title}
        </h2>
        {action}
      </div>
      <div className="mt-2">
        <ProfitAmount units={summary.profit} size="lg" />
      </div>
      <SummaryStats summary={summary} />
      <p className="mt-1.5 text-[11px] text-muted">
        {summary.bets} bet{summary.bets === 1 ? "" : "s"} · {summary.pending} pending
      </p>
    </div>
  );
}

export function SummaryTable({
  rows,
  label,
  active,
  onSelect,
}: {
  rows: { key: string; summary: ProfitSummary }[];
  label: string;
  active?: string | null;
  onSelect?: (key: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-[11px] uppercase tracking-wide text-muted">
          <tr>
            <th className="px-3 py-1.5 font-medium">{label}</th>
            <th className="px-3 py-1.5 text-right font-medium">Bets</th>
            <th className="px-3 py-1.5 text-right font-medium">Record</th>
            <th className="px-3 py-1.5 text-right font-medium">Win rate</th>
            <th className="px-3 py-1.5 text-right font-medium">ROI</th>
            <th className="px-3 py-1.5 text-right font-medium">Profit</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map(({ key, summary }) => (
            <tr key={key} className={`${onSelect ? "cursor-pointer hover:bg-panel-2/60" : ""} ${active === key ? "bg-accent/10" : ""}`} onClick={() => onSelect?.(key)}>
              <td className="max-w-[16rem] truncate px-3 py-1.5 font-medium">
                {onSelect ? (
                  <button className="hover:underline" aria-pressed={active === key} onClick={(e) => (e.stopPropagation(), onSelect(key))}>
                    {key}
                  </button>
                ) : (
                  key
                )}
              </td>
              <td className="px-3 py-1.5 text-right tabular">
                {summary.bets}
                {summary.pending ? <span className="text-[11px] text-muted"> ({summary.pending} pending)</span> : null}
              </td>
              <td className="px-3 py-1.5 text-right tabular">
                {summary.won}-{summary.lost}
                {summary.void ? `-${summary.void}` : ""}
              </td>
              <td className="px-3 py-1.5 text-right tabular">{summary.winRate === null ? "–" : `${summary.winRate}%`}</td>
              <td className={`px-3 py-1.5 text-right tabular ${summary.roi === null ? "" : summary.roi >= 0 ? "text-over" : "text-under"}`}>{pct(summary.roi)}</td>
              <td className="px-3 py-1.5 text-right">
                <ProfitAmount units={summary.profit} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
