"use client";

import { useState } from "react";
import { Plus, RotateCcw, X } from "lucide-react";
import { combineStakes } from "@/lib/bets/slip-combine";
import { formatAmount, round2 } from "@/lib/bets/profit";
import { useSettings } from "./SettingsProvider";

interface Row {
  key: number;
  stake: string;
  odds: string;
}

let next = 0;
const blank = (): Row => ({ key: ++next, stake: "", odds: "" });

/** "$100" / "100" / "1,000" -> 100; anything else -> 0. */
const amount = (v: string) => {
  const n = Number(v.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
const betsCount = (n: number) => `${n} bet${n === 1 ? "" : "s"}`;

/**
 * Profit page: the same bet placed on several accounts at different odds
 * ($100 @ 1.90 + $80 @ 1.87), as one bet - the stake in units and the odds the
 * total pays out at. Nothing is saved; use the numbers wherever you record it.
 */
export function BetCalculator({ onClose }: { onClose: () => void }) {
  const { settings } = useSettings();
  const cur = settings.currency;
  const [rows, setRows] = useState<Row[]>(() => [blank(), blank()]);
  // What a unit is worth here (e.g. a tipster you stake differently); your unit size to start with.
  const [unit, setUnit] = useState(String(settings.unitSize));
  const unitSize = amount(unit);

  const bets = rows.map((r) => ({ stake: amount(r.stake), odds: amount(r.odds) || null }));
  const total = combineStakes(bets);
  const units = total.stake > 0 && unitSize > 0 ? round4(total.stake / unitSize) : null;
  const missingOdds = bets.some((b) => b.stake > 0 && !(b.odds && b.odds > 1));
  const profit = total.payout !== null ? round2(total.payout - total.stake) : null;

  const patch = (key: number, p: Partial<Row>) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const money = (n: number, signed = false) => formatAmount(n, cur, signed);

  return (
    <section className="card w-full p-4" aria-label="Bet calculator">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Bet calculator</h2>
        <button className="rounded-md p-1 text-muted hover:text-text" onClick={onClose} aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="text-xs text-muted">
        The same bet on several accounts at different odds: add each stake and its odds to get one stake in units and the odds the total pays out at.
        Nothing is saved.
      </p>

      <div className="mt-3 flex flex-col gap-1.5">
        {rows.map((r, i) => {
          const b = bets[i];
          return (
            <div key={r.key} className="flex items-center gap-2 text-sm">
              <span className="w-10 shrink-0 text-xs text-muted sm:w-12">Bet {i + 1}</span>
              <span className="text-muted">{cur}</span>
              <input
                className="input w-20 py-1 tabular sm:w-24"
                inputMode="decimal"
                placeholder="100"
                value={r.stake}
                onChange={(e) => patch(r.key, { stake: e.target.value })}
                aria-label={`Bet ${i + 1} stake`}
              />
              <span className="text-muted">@</span>
              <input
                className="input w-16 py-1 tabular sm:w-20"
                inputMode="decimal"
                placeholder="1.90"
                value={r.odds}
                onChange={(e) => patch(r.key, { odds: e.target.value })}
                aria-label={`Bet ${i + 1} odds`}
              />
              <span className="hidden w-28 text-xs text-muted tabular sm:inline">{b.stake > 0 && b.odds && b.odds > 1 ? `pays ${money(b.stake * b.odds)}` : ""}</span>
              {rows.length > 1 && (
                <button type="button" className="rounded-md p-1 text-muted hover:text-under" onClick={() => setRows((list) => list.filter((x) => x.key !== r.key))} aria-label={`Remove bet ${i + 1}`}>
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        {rows.length < 20 && (
          <button type="button" className="flex items-center gap-1 text-accent hover:underline" onClick={() => setRows((list) => [...list, blank()])}>
            <Plus className="h-3.5 w-3.5" /> Add bet
          </button>
        )}
        <button type="button" className="flex items-center gap-1 text-muted hover:text-text" onClick={() => setRows([blank(), blank()])}>
          <RotateCcw className="h-3.5 w-3.5" /> Clear
        </button>
        <label className="ml-auto flex items-center gap-1.5 text-muted">
          1u = {cur}
          <input className="input h-7 w-20 py-0.5 text-xs tabular" inputMode="decimal" value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="Value of 1 unit" />
        </label>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 rounded-lg border border-line bg-panel-2/40 p-3 sm:grid-cols-4" aria-live="polite">
        <Result label="Units" value={units !== null ? `${units}u` : "–"} sub={total.stake > 0 ? `${money(total.stake)} staked` : "Enter the stakes"} strong />
        <Result label="Combined odds" value={total.odds !== null ? String(total.odds) : "–"} sub={missingOdds ? "Enter every bet's odds" : total.odds !== null ? betsCount(bets.filter((b) => b.stake > 0).length) : ""} strong />
        <Result label="Pays if it wins" value={total.payout !== null ? money(total.payout) : "–"} />
        <Result
          label="Profit if it wins"
          value={profit !== null ? money(profit, true) : "–"}
          sub={profit !== null && unitSize > 0 ? `${profit >= 0 ? "+" : ""}${round2(profit / unitSize)}u` : ""}
          tone={profit !== null ? "text-over" : undefined}
        />
      </div>
    </section>
  );
}

function Result({ label, value, sub, strong, tone }: { label: string; value: string; sub?: string; strong?: boolean; tone?: string }) {
  return (
    <div>
      <p className="label">{label}</p>
      <p className={`tabular ${strong ? "text-xl font-semibold" : "text-lg"} ${tone ?? "text-text"}`}>{value}</p>
      {sub ? <p className="text-[11px] text-muted">{sub}</p> : null}
    </div>
  );
}
