"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Bot, Trophy, User } from "lucide-react";
import type { BetRowWithMatch } from "@/lib/bets/queries";
import { formatUnits, summarize, summarizeBy, type ProfitSummary } from "@/lib/bets/profit";
import { formatDayLabel, formatTime } from "@/lib/format";
import { PlayTypeChip, ProfitAmount, ResultChip } from "./BetBits";
import { useSettings } from "./SettingsProvider";
import { useToday } from "./useNow";
import { ProfitChart } from "./ProfitChart";
import { DailyCalendar } from "./DailyCalendar";
import { cumulativeSeries, dailyPL, dayKey } from "@/lib/bets/daily";
import { X } from "lucide-react";
import { DateTime } from "luxon";
import { SELECTIONS, SELECTION_LABEL, type Selection } from "@/lib/selection";
import { PICK_SERIES, PickCompareChart } from "./PickCompareChart";
import { AddPastBet } from "./AddPastBet";

type Period = "7d" | "30d" | "90d" | "all";
type TypeFilter = "ALL" | "BOT" | "PERSONAL";
type PickFilter = "ALL" | Selection;
type SortKey = "date" | "profit" | "stake" | "odds";

const PERIODS: { id: Period; label: string; days: number | null }[] = [
  { id: "7d", label: "7D", days: 7 },
  { id: "30d", label: "30D", days: 30 },
  { id: "90d", label: "90D", days: 90 },
  { id: "all", label: "All", days: null },
];

function pct(n: number | null): string {
  return n === null ? "–" : `${n > 0 ? "+" : ""}${n}%`;
}

/**
 * `title` changes the heading (e.g. "Sam's profit" when tailing); `readOnly`
 * is for someone else's bets: no links to match pages you can't open.
 */
export function ProfitPage({ initial, title = "Profit", readOnly = false }: { initial: BetRowWithMatch[]; title?: string; readOnly?: boolean }) {
  const { settings } = useSettings();
  const tz = settings.timezone;
  const [period, setPeriod] = useState<{ id: Period; fromDay: string | null }>({ id: "all", fromDay: null });
  const [type, setType] = useState<TypeFilter>("ALL");
  const [pick, setPick] = useState<PickFilter>("ALL");
  const [chartMode, setChartMode] = useState<"total" | "picks">("total");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "date", desc: true });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const today = useToday(tz);

  const inPeriod = useMemo(
    () => (period.fromDay === null ? initial : initial.filter((r) => dayKey(r.startsAt, tz) >= period.fromDay!)),
    [initial, period.fromDay, tz],
  );
  const typeOk = useCallback((r: BetRowWithMatch) => type === "ALL" || r.playType === type, [type]);
  const pickOk = useCallback((r: BetRowWithMatch) => pick === "ALL" || r.selection === pick, [pick]);
  const bot = useMemo(() => summarize(inPeriod.filter((r) => r.playType === "BOT" && pickOk(r))), [inPeriod, pickOk]);
  const personal = useMemo(() => summarize(inPeriod.filter((r) => r.playType === "PERSONAL" && pickOk(r))), [inPeriod, pickOk]);
  // Over / Under / Sweep performance for the chosen play type.
  const picks = useMemo(
    () => SELECTIONS.map((sel) => ({ sel, summary: summarize(inPeriod.filter((r) => typeOk(r) && r.selection === sel)) })),
    [inPeriod, typeOk],
  );
  const filtered = useMemo(() => inPeriod.filter((r) => typeOk(r) && pickOk(r)), [inPeriod, typeOk, pickOk]);
  const overall = useMemo(() => summarize(filtered), [filtered]);
  const byCompetition = useMemo(() => summarizeBy(filtered, (r) => r.competition ?? "Unknown competition"), [filtered]);

  // Daily P/L for the chosen play type (the calendar can page through any month).
  const daily = useMemo(() => dailyPL(initial.filter((r) => typeOk(r) && pickOk(r)), tz), [initial, typeOk, pickOk, tz]);
  const series = useMemo(() => {
    const keys = [...daily.keys()].sort();
    const to = today ?? keys[keys.length - 1];
    const from = period.fromDay ?? keys[0];
    return from && to ? cumulativeSeries(daily, from, to < from ? from : to) : [];
  }, [daily, today, period.fromDay]);
  // One running total per pick, over the same days.
  const pickSeries = useMemo(() => {
    const perPick = SELECTIONS.map((sel) => ({ sel, days: dailyPL(initial.filter((r) => typeOk(r) && r.selection === sel), tz) }));
    const keys = perPick.flatMap((p) => [...p.days.keys()]).sort();
    const to = today ?? keys[keys.length - 1];
    const from = period.fromDay ?? keys[0];
    if (!from || !to) return [];
    return perPick.map((p) => ({ pick: p.sel, points: cumulativeSeries(p.days, from, to < from ? from : to) }));
  }, [initial, typeOk, today, period.fromDay, tz]);
  const scope = [type === "ALL" ? "all plays" : type === "BOT" ? "bot plays" : "personal plays", pick === "ALL" ? null : `${SELECTION_LABEL[pick]} picks`]
    .filter(Boolean)
    .join(" · ");

  const sorted = useMemo(() => {
    const val = (r: BetRowWithMatch): number => {
      switch (sort.key) {
        case "profit":
          return r.profit ?? (sort.desc ? -Infinity : Infinity);
        case "stake":
          return r.stake;
        case "odds":
          return r.odds ?? (sort.desc ? -Infinity : Infinity);
        default:
          return new Date(r.startsAt).getTime();
      }
    };
    // A day picked on the calendar shows that day's bets, whatever the period.
    const rows = selectedDay
      ? initial.filter((r) => typeOk(r) && pickOk(r) && dayKey(r.startsAt, tz) === selectedDay)
      : filtered;
    return [...rows].sort((a, b) => (sort.desc ? val(b) - val(a) : val(a) - val(b)));
  }, [filtered, initial, typeOk, pickOk, sort, selectedDay, tz]);

  // The most profitable pick (only once at least two picks have settled bets).
  const settledPicks = picks.filter((p) => p.summary.settled > 0).sort((a, b) => b.summary.profit - a.summary.profit);
  const pickLeader =
    settledPicks.length >= 2 && settledPicks[0].summary.profit !== settledPicks[1].summary.profit ? settledPicks[0].sel : null;
  const leader = bot.settled && personal.settled ? (bot.profit === personal.profit ? null : bot.profit > personal.profit ? "BOT" : "PERSONAL") : null;
  const sortBy = (key: SortKey) => setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: true }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {readOnly ? <h2 className="text-lg font-semibold tracking-tight">{title}</h2> : <h1 className="text-xl font-semibold tracking-tight">{title}</h1>}
          <p className="text-sm text-muted">
            In units · {readOnly ? "money amounts use your unit size, " : ""}1u = {settings.currency}
            {settings.unitSize}
            {" "}(change in{" "}
            <Link href="/settings#units" className="underline hover:text-text">
              Settings
            </Link>
            )
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Segmented
            label="Period"
            value={period.id}
            options={PERIODS.map((p) => ({ id: p.id, label: p.label }))}
            onChange={(id) => {
              const p = PERIODS.find((x) => x.id === id)!;
              // "7D" = today and the 6 days before it (calendar days in the user's timezone).
              const fromDay = p.days ? DateTime.now().setZone(tz).minus({ days: p.days - 1 }).toISODate() : null;
              setPeriod({ id: p.id, fromDay });
            }}
          />
          <Segmented
            label="Play type"
            value={type}
            options={[
              { id: "ALL", label: "All" },
              { id: "BOT", label: "Bot" },
              { id: "PERSONAL", label: "Personal" },
            ]}
            onChange={(id) => setType(id as TypeFilter)}
          />
          <Segmented
            label="Pick"
            value={pick}
            options={[{ id: "ALL", label: "All picks" }, ...SELECTIONS.map((sel) => ({ id: sel, label: SELECTION_LABEL[sel] }))]}
            onChange={(id) => setPick(id as PickFilter)}
          />
        </div>
      </div>

      {!readOnly && (
        <div className="flex justify-end">
          <AddPastBet />
        </div>
      )}

      <section className="card grid grid-cols-2 gap-4 p-4 sm:grid-cols-5">
        <div className="col-span-2">
          <p className="label">Profit · {scope}</p>
          <ProfitAmount units={overall.profit} size="lg" />
        </div>
        <Stat label="ROI" value={pct(overall.roi)} tone={overall.roi === null ? undefined : overall.roi >= 0 ? "text-over" : "text-under"} />
        <Stat label="Win rate" value={overall.winRate === null ? "–" : `${overall.winRate}%`} sub={`${overall.won}W - ${overall.lost}L${overall.void ? ` - ${overall.void}V` : ""}`} />
        <Stat label="Staked" value={formatUnits(overall.staked, false)} sub={`${overall.bets} bets · ${overall.pending} pending`} />
      </section>

      {overall.missingOdds > 0 && (
        <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          {overall.missingOdds} won bet(s) have no odds yet, so their profit is not counted. Add the odds on the match.
        </p>
      )}

      <section className="grid gap-3 sm:grid-cols-2">
        <PlayTypeCard title="Bot plays" icon={<Bot className="h-4 w-4" />} summary={bot} leading={leader === "BOT"} active={type === "BOT"} onSelect={() => setType(type === "BOT" ? "ALL" : "BOT")} />
        <PlayTypeCard
          title="Personal plays"
          icon={<User className="h-4 w-4" />}
          summary={personal}
          leading={leader === "PERSONAL"}
          active={type === "PERSONAL"}
          onSelect={() => setType(type === "PERSONAL" ? "ALL" : "PERSONAL")}
        />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">
          Picks <span className="font-normal text-muted">· how OVER, UNDER and SWEEP are doing{type === "ALL" ? "" : ` (${type === "BOT" ? "bot" : "personal"} plays)`}</span>
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {picks.map(({ sel, summary }) => (
            <PlayTypeCard
              key={sel}
              title={SELECTION_LABEL[sel]}
              icon={
                <svg width="16" height="8" aria-hidden="true">
                  <line x1="1" x2="15" y1="4" y2="4" stroke={PICK_SERIES[sel].color} strokeWidth="3" strokeDasharray={PICK_SERIES[sel].dash} strokeLinecap="round" />
                </svg>
              }
              summary={summary}
              leading={pickLeader === sel}
              active={pick === sel}
              onSelect={() => setPick(pick === sel ? "ALL" : sel)}
            />
          ))}
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <div className="card min-w-0 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">
              Running profit
              <span className="font-normal text-muted"> · {chartMode === "picks" ? `by pick${type === "ALL" ? "" : ` · ${type === "BOT" ? "bot" : "personal"} plays`}` : scope}</span>
            </h2>
            <span className="flex items-center gap-2">
              <span className="text-xs text-muted">{period.fromDay ? `last ${PERIODS.find((x) => x.id === period.id)!.days} days` : "all time"}</span>
              <Segmented
                label="Chart"
                value={chartMode}
                options={[
                  { id: "total", label: "Total" },
                  { id: "picks", label: "By pick" },
                ]}
                onChange={(id) => setChartMode(id as "total" | "picks")}
              />
            </span>
          </div>
          {chartMode === "picks" ? (
            <PickCompareChart series={pickSeries} unitSize={settings.unitSize} currency={settings.currency} />
          ) : (
            <ProfitChart points={series} unitSize={settings.unitSize} currency={settings.currency} />
          )}
        </div>
        <div className="card min-w-0 p-3">
          <h2 className="mb-2 text-sm font-semibold">
            Daily P/L
            <span className="font-normal text-muted"> · {scope}</span>
          </h2>
          <DailyCalendar days={daily} today={today} selected={selectedDay} onSelect={setSelectedDay} unitSize={settings.unitSize} currency={settings.currency} />
        </div>
      </section>

      {byCompetition.length > 1 && (
        <section className="card overflow-hidden">
          <h2 className="border-b border-line px-3 py-2 text-sm font-semibold">By competition</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-1.5 font-medium">Competition</th>
                  <th className="px-3 py-1.5 text-right font-medium">Bets</th>
                  <th className="px-3 py-1.5 text-right font-medium">Win rate</th>
                  <th className="px-3 py-1.5 text-right font-medium">ROI</th>
                  <th className="px-3 py-1.5 text-right font-medium">Profit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {byCompetition.map(({ key, summary }) => (
                  <tr key={key}>
                    <td className="max-w-[16rem] truncate px-3 py-1.5">{key}</td>
                    <td className="px-3 py-1.5 text-right tabular">{summary.bets}</td>
                    <td className="px-3 py-1.5 text-right tabular">{summary.winRate === null ? "–" : `${summary.winRate}%`}</td>
                    <td className="px-3 py-1.5 text-right tabular">{pct(summary.roi)}</td>
                    <td className="px-3 py-1.5 text-right">
                      <ProfitAmount units={summary.profit} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            Bets
            {selectedDay && (
              <button className="chip gap-1 bg-accent/15 text-accent" onClick={() => setSelectedDay(null)} aria-label="Show all days">
                {DateTime.fromISO(selectedDay).toFormat("ccc d LLL")} <X className="h-3 w-3" />
              </button>
            )}
          </h2>
          <span className="text-xs text-muted">{sorted.length} shown</span>
        </div>
        {sorted.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted">
            No bets yet. Click &ldquo;I&apos;ve placed the bet&rdquo; on an alarm, or &ldquo;Record bet&rdquo; on a match card, then mark it Won / Lost.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <SortHeader label="Date" k="date" sort={sort} onSort={sortBy} />
                  <th className="px-3 py-1.5 font-medium">Match</th>
                  <th className="px-3 py-1.5 font-medium">Type</th>
                  <SortHeader label="Stake" k="stake" sort={sort} onSort={sortBy} right />
                  <SortHeader label="Odds" k="odds" sort={sort} onSort={sortBy} right />
                  <th className="px-3 py-1.5 font-medium">Result</th>
                  <SortHeader label="Profit" k="profit" sort={sort} onSort={sortBy} right />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {sorted.map((r) => (
                  <tr key={r.id} className="hover:bg-panel-2/60">
                    <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted">
                      {formatDayLabel(r.startsAt, tz)} {formatTime(r.startsAt, tz)}
                    </td>
                    <td className="max-w-[18rem] px-3 py-1.5">
                      {readOnly ? (
                        <span className="block truncate">
                          {r.player1} <span className="text-muted">vs</span> {r.player2}
                        </span>
                      ) : (
                        <Link href={`/matches/${r.matchId}`} className="block truncate hover:underline">
                          {r.player1} <span className="text-muted">vs</span> {r.player2}
                        </Link>
                      )}
                      <span className="block truncate text-[11px] text-muted">
                        {r.selection ? `${r.selection}${r.pointsLine !== null ? ` ${r.pointsLine}` : ""} · ` : ""}
                        {r.split ? `split ${r.split.index + 1}/${r.split.of} · ` : ""}
                        {r.competition ?? "Unknown competition"}
                      </span>
                    </td>
                    <td className="px-3 py-1.5">
                      <PlayTypeChip playType={r.playType} />
                    </td>
                    <td className="px-3 py-1.5 text-right tabular">{formatUnits(r.stake, false)}</td>
                    <td className="px-3 py-1.5 text-right tabular">{r.odds ? r.odds.toFixed(2) : "–"}</td>
                    <td className="px-3 py-1.5">
                      <ResultChip result={r.result} />
                    </td>
                    <td className="px-3 py-1.5 text-right">{r.profit !== null ? <ProfitAmount units={r.profit} /> : <span className="text-muted">–</span>}</td>
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

function Segmented({ label, value, options, onChange }: { label: string; value: string; options: { id: string; label: string }[]; onChange: (id: string) => void }) {
  return (
    <div className="flex rounded-lg border border-line bg-panel p-0.5 text-xs" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={value === o.id}
          className={`rounded-md px-2.5 py-1 ${value === o.id ? "bg-panel-2 font-semibold text-text" : "text-muted hover:text-text"}`}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div>
      <p className="label">{label}</p>
      <p className={`tabular text-lg font-semibold ${tone ?? ""}`}>{value}</p>
      {sub && <p className="text-[11px] text-muted">{sub}</p>}
    </div>
  );
}

function PlayTypeCard({
  title,
  icon,
  summary,
  leading,
  active,
  onSelect,
}: {
  title: string;
  icon: React.ReactNode;
  summary: ProfitSummary;
  leading: boolean;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button onClick={onSelect} aria-pressed={active} className={`card p-3 text-left transition-colors hover:border-muted/40 ${active ? "ring-2 ring-accent" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          {icon} {title}
        </h2>
        {leading && (
          <span className="chip gap-1 bg-over/15 text-over">
            <Trophy className="h-3 w-3" /> More profitable
          </span>
        )}
      </div>
      <div className="mt-2">
        <ProfitAmount units={summary.profit} size="lg" />
      </div>
      <dl className="mt-2 grid grid-cols-4 gap-2 text-xs">
        <div>
          <dt className="text-muted">ROI</dt>
          <dd className={`tabular font-semibold ${summary.roi === null ? "" : summary.roi >= 0 ? "text-over" : "text-under"}`}>{pct(summary.roi)}</dd>
        </div>
        <div>
          <dt className="text-muted">Win rate</dt>
          <dd className="tabular font-semibold">{summary.winRate === null ? "–" : `${summary.winRate}%`}</dd>
        </div>
        <div>
          <dt className="text-muted">Record</dt>
          <dd className="tabular font-semibold">
            {summary.won}-{summary.lost}
            {summary.void ? `-${summary.void}` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Staked</dt>
          <dd className="tabular font-semibold">{formatUnits(summary.staked, false)}</dd>
        </div>
      </dl>
      <p className="mt-1 text-[11px] text-muted">
        {summary.bets} bets · {summary.pending} pending{summary.avgOdds ? ` · avg odds ${summary.avgOdds.toFixed(2)}` : ""}
      </p>
    </button>
  );
}

function SortHeader({ label, k, sort, onSort, right }: { label: string; k: SortKey; sort: { key: SortKey; desc: boolean }; onSort: (k: SortKey) => void; right?: boolean }) {
  const active = sort.key === k;
  return (
    <th className={`px-3 py-1.5 font-medium ${right ? "text-right" : ""}`} aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}>
      <button className={`inline-flex items-center gap-0.5 uppercase ${active ? "text-text" : "hover:text-text"}`} onClick={() => onSort(k)}>
        {label}
        {active && (sort.desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
      </button>
    </th>
  );
}
