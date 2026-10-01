"use client";

import Link from "next/link";
import { useState } from "react";
import { Medal, Percent, TrendingUp } from "lucide-react";
import type { Leaderboard, LeaderboardRow } from "@/lib/leaderboard";
import { formatUnits } from "@/lib/bets/profit";

type Type = "ALL" | "BOT" | "PERSONAL";

const pct = (n: number | null) => (n === null ? "–" : `${n > 0 ? "+" : ""}${n}%`);

/** Rankings across all accounts: most units profited and highest ROI. */
export function LeaderboardPage({ boards, currentUserId }: { boards: Record<Type, Leaderboard>; currentUserId: string }) {
  const [type, setType] = useState<Type>("ALL");
  const board = boards[type];
  const me = board.me;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Leaderboard</h1>
          <p className="text-sm text-muted">Accounts with at least {board.minBets} settled bets. Results in units, so different unit sizes compare fairly.</p>
        </div>
        <div className="flex rounded-lg border border-line bg-panel p-0.5 text-xs" role="radiogroup" aria-label="Play type">
          {(
            [
              ["ALL", "All plays"],
              ["BOT", "Bot plays"],
              ["PERSONAL", "Personal plays"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="radio"
              aria-checked={type === id}
              onClick={() => setType(id)}
              className={`rounded-md px-2.5 py-1 ${type === id ? "bg-panel-2 font-semibold text-text" : "text-muted hover:text-text"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <section className="card flex flex-wrap items-center gap-x-6 gap-y-2 p-3 text-sm">
        <span className="font-semibold">You</span>
        {!me ? (
          <span className="text-muted">No settled bets yet.</span>
        ) : (
          <>
            <span>
              <span className={`tabular font-semibold ${me.profit > 0 ? "text-over" : me.profit < 0 ? "text-under" : ""}`}>{formatUnits(me.profit)}</span>
              <span className="text-muted"> · ROI </span>
              <span className="tabular font-semibold">{pct(me.roi)}</span>
              <span className="text-muted"> · {me.bets} bets</span>
            </span>
            {me.hidden ? (
              <span className="text-muted">
                Hidden from the leaderboard (
                <Link href="/settings" className="underline">
                  Settings
                </Link>
                )
              </span>
            ) : me.bets < board.minBets ? (
              <span className="flex items-center gap-2 text-muted">
                <span className="h-1.5 w-28 overflow-hidden rounded-full bg-line">
                  <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (me.bets / board.minBets) * 100)}%` }} />
                </span>
                {board.minBets - me.bets} more settled bets to be ranked
              </span>
            ) : (
              <span className="text-muted">
                #{me.rankProfit} for units · #{me.rankRoi ?? "–"} for ROI
              </span>
            )}
          </>
        )}
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        <Board
          title="Most units profited"
          icon={<TrendingUp className="h-4 w-4" />}
          rows={board.byProfit}
          currentUserId={currentUserId}
          primary={(r) => <span className={`tabular font-semibold ${r.profit > 0 ? "text-over" : r.profit < 0 ? "text-under" : ""}`}>{formatUnits(r.profit)}</span>}
          secondary={(r) => `ROI ${pct(r.roi)}`}
          minBets={board.minBets}
        />
        <Board
          title="Highest ROI"
          icon={<Percent className="h-4 w-4" />}
          rows={board.byRoi}
          currentUserId={currentUserId}
          primary={(r) => <span className={`tabular font-semibold ${(r.roi ?? 0) > 0 ? "text-over" : (r.roi ?? 0) < 0 ? "text-under" : ""}`}>{pct(r.roi)}</span>}
          secondary={(r) => formatUnits(r.profit)}
          minBets={board.minBets}
        />
      </div>
    </div>
  );
}

function Board({
  title,
  icon,
  rows,
  currentUserId,
  primary,
  secondary,
  minBets,
}: {
  title: string;
  icon: React.ReactNode;
  rows: (LeaderboardRow & { rank: number })[];
  currentUserId: string;
  primary: (r: LeaderboardRow) => React.ReactNode;
  secondary: (r: LeaderboardRow) => string;
  minBets: number;
}) {
  return (
    <section className="card overflow-hidden">
      <h2 className="flex items-center gap-1.5 border-b border-line px-3 py-2 text-sm font-semibold">
        {icon} {title}
      </h2>
      {rows.length === 0 ? (
        <p className="px-3 py-8 text-center text-sm text-muted">Nobody has {minBets} settled bets yet.</p>
      ) : (
        <ol className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.userId} className={`flex items-center gap-3 px-3 py-2 text-sm ${r.userId === currentUserId ? "bg-accent/10" : ""}`}>
              <span className="w-7 shrink-0 text-center tabular font-semibold">
                {r.rank <= 3 ? <Medal className={`mx-auto h-4 w-4 ${["text-amber-300", "text-slate-300", "text-orange-400"][r.rank - 1]}`} aria-label={`#${r.rank}`} /> : `#${r.rank}`}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {r.name}
                  {r.userId === currentUserId && <span className="ml-1.5 chip bg-accent/20 text-accent">You</span>}
                </span>
                <span className="block text-[11px] text-muted">
                  {r.bets} bets · {r.won}W-{r.lost}L{r.winRate !== null ? ` · ${r.winRate}%` : ""}
                </span>
              </span>
              <span className="text-right">
                <span className="block">{primary(r)}</span>
                <span className="block text-[11px] text-muted">{secondary(r)}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
