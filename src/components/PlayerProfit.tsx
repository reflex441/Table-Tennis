"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { ROI_MIN_BETS, byPair, byPlayer, sortStats, type PlayerRow, type PlayerSort } from "@/lib/bets/by-player";
import { nameFits } from "@/lib/bets/past-games";
import { ProfitAmount } from "./BetBits";
import { Segmented } from "./Segmented";
import { pct } from "./SummaryStats";

export type PlayerKind = "player" | "pair";

const SORTS: { id: PlayerSort; label: string }[] = [
  { id: "profit", label: "Most profit" },
  { id: "loss", label: "Least profit" },
  { id: "roi", label: "ROI" },
  { id: "bets", label: "Most bets" },
];

const SHOW = 10;

/**
 * Profit page: profit by player, or by the two players meeting, for the
 * bets the page's filters show. Sortable; click one to see its bets in the
 * Bets table.
 */
export function PlayerProfit({
  rows,
  scope,
  selected,
  onSelect,
}: {
  rows: PlayerRow[];
  scope: string;
  selected: { kind: PlayerKind; key: string } | null;
  onSelect: (pick: { kind: PlayerKind; key: string; label: string } | null) => void;
}) {
  const [kind, setKind] = useState<PlayerKind>("player");
  const [sort, setSort] = useState<PlayerSort>("profit");
  const [find, setFind] = useState("");
  const [all, setAll] = useState(false);

  const stats = useMemo(() => sortStats(kind === "pair" ? byPair(rows) : byPlayer(rows), sort), [rows, kind, sort]);
  // "Find": players whose name fits; for pairs, either player's.
  const found = useMemo(() => {
    if (find.trim().length < 2) return stats;
    return stats.filter((s) => s.label.split(" vs ").some((name) => nameFits(name, find)));
  }, [stats, find]);
  const shown = all || find.trim() ? found : found.slice(0, SHOW);
  const noun = kind === "pair" ? "pairs" : "players";
  // On a phone there's room for one of Bets / ROI: ROI when sorting by it.
  const betsCol = sort === "roi" ? "hidden sm:table-cell" : "";
  const roiCol = sort === "roi" ? "" : "hidden sm:table-cell";

  return (
    <section className="card overflow-hidden" aria-label="Profit by player">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
        <h2 className="text-sm font-semibold">
          {kind === "pair" ? "Player pairs" : "Players"}
          <span className="font-normal text-muted"> · {scope}</span>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <input
              className="input h-7 w-40 py-0.5 pl-7 text-xs"
              placeholder="Find a player"
              value={find}
              onChange={(e) => setFind(e.target.value)}
              aria-label="Find a player"
            />
          </label>
          <Segmented
            label="Group by"
            value={kind}
            options={[
              { id: "player", label: "Each player" },
              { id: "pair", label: "Pairs" },
            ]}
            onChange={(id) => {
              setKind(id as PlayerKind);
              setAll(false);
            }}
          />
          <Segmented label="Sort by" value={sort} options={SORTS} onChange={(id) => setSort(id as PlayerSort)} />
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-muted">{find.trim() ? `No ${noun} found.` : `No settled bets yet.`}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="w-8 px-3 py-1.5 font-medium">#</th>
                <th className="px-3 py-1.5 font-medium">{kind === "pair" ? "Pair" : "Player"}</th>
                <th className={`px-3 py-1.5 text-right font-medium ${betsCol}`}>Bets</th>
                <th className="hidden px-3 py-1.5 text-right font-medium sm:table-cell">Record</th>
                <th className="hidden px-3 py-1.5 text-right font-medium sm:table-cell">Win rate</th>
                <th className={`px-3 py-1.5 text-right font-medium ${roiCol}`}>ROI</th>
                <th className="px-3 py-1.5 text-right font-medium">Profit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((s) => {
                const active = selected?.kind === kind && selected.key === s.key;
                const rank = stats.indexOf(s) + 1;
                const [a, b] = s.label.split(" vs ");
                return (
                  <tr
                    key={s.key}
                    className={`cursor-pointer ${active ? "bg-accent/10" : "hover:bg-panel-2/60"}`}
                    onClick={() => onSelect(active ? null : { kind, key: s.key, label: s.label })}
                    title={active ? "Show all bets" : "Show these bets below"}
                  >
                    <td className="px-3 py-1.5 text-xs text-muted tabular">{rank}</td>
                    <td className="max-w-[18rem] px-3 py-1.5">
                      <button type="button" className="block max-w-full truncate text-left" aria-pressed={active}>
                        {b === undefined ? (
                          a
                        ) : (
                          <>
                            {a} <span className="text-muted">vs</span> {b}
                          </>
                        )}
                      </button>
                    </td>
                    <td className={`px-3 py-1.5 text-right tabular ${betsCol}`}>
                      {s.summary.bets}
                      {s.summary.pending ? <span className="text-[11px] text-muted"> ({s.summary.pending} open)</span> : null}
                    </td>
                    <td className="hidden px-3 py-1.5 text-right tabular sm:table-cell">
                      {s.summary.won}-{s.summary.lost}
                      {s.summary.void ? `-${s.summary.void}` : ""}
                    </td>
                    <td className="hidden px-3 py-1.5 text-right tabular sm:table-cell">{s.summary.winRate === null ? "–" : `${s.summary.winRate}%`}</td>
                    <td className={`px-3 py-1.5 text-right tabular ${roiCol} ${sort === "roi" && s.summary.settled < ROI_MIN_BETS ? "text-muted" : ""}`}>{pct(s.summary.roi)}</td>
                    <td className="px-3 py-1.5 text-right">
                      <ProfitAmount units={s.summary.profit} money={s.summary.profitMoney} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2 text-[11px] text-muted">
        <span>
          Click a {kind === "pair" ? "pair" : "player"} to see the bets below.{" "}
          {kind === "pair" ? "A pair is the two players in either order." : "A bet counts for both players of its match."}
          {sort === "roi" ? ` ROI of fewer than ${ROI_MIN_BETS} settled bets is listed last.` : ""}
        </span>
        {!find.trim() && found.length > SHOW && (
          <button className="font-medium text-accent hover:underline" onClick={() => setAll(!all)}>
            {all ? `Show top ${SHOW}` : `Show all ${found.length} ${noun}`}
          </button>
        )}
      </div>
    </section>
  );
}
