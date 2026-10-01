"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import type { TailAccount } from "@/lib/tailing";
import { TailAccountCard } from "./TailAccountCard";

/** Accounts you tail, and everyone else you could tail. */
export function TailingPage({ initial }: { initial: { tailing: TailAccount[]; others: TailAccount[] } }) {
  const [accounts, setAccounts] = useState(() => [...initial.tailing, ...initial.others]);
  const [query, setQuery] = useState("");

  const setTailed = (id: string, tailed: boolean) => setAccounts((all) => all.map((a) => (a.id === id ? { ...a, tailed } : a)));
  const tailing = accounts.filter((a) => a.tailed);
  const q = query.trim().toLowerCase();
  const others = accounts.filter((a) => !a.tailed && a.open && (!q || a.name.toLowerCase().includes(q)));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Tailing</h1>
        <p className="text-sm text-muted">Tail other accounts to see their profit and bets, and copy their upcoming bets to your dashboard.</p>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold">
          Accounts you tail <span className="font-normal text-muted">({tailing.length})</span>
        </h2>
        {tailing.length === 0 ? (
          <p className="card px-4 py-8 text-center text-sm text-muted">You aren&apos;t tailing anyone yet. Pick someone below (or from the Leaderboard).</p>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {tailing.map((a) => (
              <TailAccountCard key={a.id} account={a} onChange={(t) => setTailed(a.id, t)} />
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Find accounts</h2>
          <label className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input className="input pl-8" placeholder="Search by name" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search accounts" />
          </label>
        </div>
        {others.length === 0 ? (
          <p className="card px-4 py-8 text-center text-sm text-muted">{query ? "No accounts match that name." : "No other accounts to tail yet."}</p>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {others.map((a) => (
              <TailAccountCard key={a.id} account={a} onChange={(t) => setTailed(a.id, t)} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
