"use client";

import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { DateTime } from "luxon";
import { api } from "@/lib/client-api";
import { fromLocalInputValue, toLocalInputValue } from "@/lib/format";
import { round2, type BetResult } from "@/lib/bets/profit";
import { NBA_MARKETS, NBA_MARKET_LABEL, parseOdds, type NbaMarket } from "@/lib/nba/parse";
import type { NbaBetDTO } from "@/lib/nba/service";
import { useSettings } from "../SettingsProvider";
import { DateTimeInput } from "../DateTimeInput";

export interface NbaDraft {
  tipster: string;
  pick: string;
  market: NbaMarket;
  game: string;
  units: string;
  odds: string;
  bookmaker: string;
  placedAtLocal: string;
  result: BetResult;
}

export const RESULT_LABEL: Record<BetResult, string> = { PENDING: "Pending", WON: "Won", LOST: "Lost", VOID: "Void" };

export function draftFromBet(b: NbaBetDTO, tz: string): NbaDraft {
  return {
    tipster: b.tipster,
    pick: b.pick,
    market: b.market,
    game: b.game ?? "",
    units: String(b.stake),
    odds: b.odds !== null ? String(b.odds) : "",
    bookmaker: b.bookmaker ?? "",
    placedAtLocal: toLocalInputValue(b.placedAt, tz),
    result: b.result,
  };
}

/** Problem with a draft, or the JSON to send. */
export function draftToJson(d: NbaDraft, tz: string): string | Record<string, unknown> {
  if (!d.tipster.trim()) return "Enter whose pick it is.";
  if (!d.pick.trim()) return "Enter the pick.";
  const units = Number(d.units);
  if (!Number.isFinite(units) || units <= 0) return "Units must be above 0.";
  const odds = d.odds.trim() ? parseOdds(d.odds) : null;
  if (d.odds.trim() && odds === null) return "Odds must be decimal (1.72) or American (+138).";
  if (odds === null && d.result === "WON") return "Enter the odds so the win's profit can be counted.";
  const placedAt = fromLocalInputValue(d.placedAtLocal, tz);
  if (!placedAt) return "Enter the date and time.";
  return {
    tipster: d.tipster.trim(),
    pick: d.pick.trim(),
    market: d.market,
    game: d.game.trim() || null,
    stake: round2(units),
    odds,
    bookmaker: d.bookmaker.trim() || null,
    placedAt,
    result: d.result,
  };
}

/** Lists for the tipster and bookmaker boxes. */
export function NbaDatalists({ tipsters }: { tipsters: string[] }) {
  const { settings } = useSettings();
  const books = [...new Set(settings.nbaBookmakers.map((b) => b.name))].sort();
  return (
    <>
      <datalist id="nba-tipsters">
        {tipsters.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <datalist id="nba-bookmakers">
        {books.map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>
    </>
  );
}

/** The fields of an NBA bet (add, edit and scanned rows). */
export function NbaFields({ d, onChange, compact = false }: { d: NbaDraft; onChange: (patch: Partial<NbaDraft>) => void; compact?: boolean }) {
  const pad = compact ? "py-1" : "py-1.5";
  const parsed = d.odds.trim() ? parseOdds(d.odds) : null;
  const american = /^[+-]\s?\d{3}/.test(d.odds.trim());
  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className="flex flex-wrap items-end gap-2">
        <label className="w-32">
          <span className="label">Tipster</span>
          <input className={`input ${pad}`} list="nba-tipsters" value={d.tipster} onChange={(e) => onChange({ tipster: e.target.value })} aria-label="Tipster" />
        </label>
        <label className="min-w-48 flex-1">
          <span className="label">Pick</span>
          <input className={`input ${pad}`} value={d.pick} onChange={(e) => onChange({ pick: e.target.value })} placeholder="De'Aaron Fox Over 1.5 3PM" aria-label="Pick" />
        </label>
        <label className="w-32">
          <span className="label">Market</span>
          <select className={`input ${pad}`} value={d.market} onChange={(e) => onChange({ market: e.target.value as NbaMarket })} aria-label="Market">
            {NBA_MARKETS.map((m) => (
              <option key={m} value={m}>
                {NBA_MARKET_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="w-20">
          <span className="label">Units</span>
          <input className={`input ${pad} tabular`} inputMode="decimal" value={d.units} onChange={(e) => onChange({ units: e.target.value })} aria-label="Units" />
          <span className="mt-0.5 block h-3.5" />
        </label>
        <label className="w-24">
          <span className="label">Odds</span>
          <input className={`input ${pad} tabular`} value={d.odds} onChange={(e) => onChange({ odds: e.target.value })} placeholder="1.72 / +138" aria-label="Odds" />
          <span className="mt-0.5 block h-3.5 text-[10px] text-muted">{american && parsed ? `= ${parsed.toFixed(2)}` : ""}</span>
        </label>
        <label className="w-32">
          <span className="label">Bookmaker</span>
          <input className={`input ${pad}`} list="nba-bookmakers" value={d.bookmaker} onChange={(e) => onChange({ bookmaker: e.target.value })} aria-label="Bookmaker" />
          <span className="mt-0.5 block h-3.5" />
        </label>
        <div>
          <span className="label">Posted</span>
          <DateTimeInput value={d.placedAtLocal} onChange={(v) => onChange({ placedAtLocal: v })} label="Posted" compact={compact} />
        </div>
        <label className="w-28">
          <span className="label">Result</span>
          <select className={`input ${pad}`} value={d.result} onChange={(e) => onChange({ result: e.target.value as BetResult })} aria-label="Result">
            {(["PENDING", "WON", "LOST", "VOID"] as const).map((r) => (
              <option key={r} value={r}>
                {RESULT_LABEL[r]}
              </option>
            ))}
          </select>
          <span className="mt-0.5 block h-3.5" />
        </label>
      </div>
      {!compact && (
        <label>
          <span className="label">Game (optional)</span>
          <input className="input py-1.5" value={d.game} onChange={(e) => onChange({ game: e.target.value })} placeholder="New York Knicks @ San Antonio Spurs" aria-label="Game" />
        </label>
      )}
    </div>
  );
}

/** Add an NBA bet by hand, or edit one. */
export function NbaBetForm({
  bet,
  tipsters,
  onSaved,
  onClose,
}: {
  bet?: NbaBetDTO;
  tipsters: string[];
  onSaved: (bet: NbaBetDTO) => void;
  onClose: () => void;
}) {
  const { settings } = useSettings();
  const tz = settings.timezone;
  const [d, setD] = useState<NbaDraft>(() =>
    bet
      ? draftFromBet(bet, tz)
      : {
          tipster: "",
          pick: "",
          market: "OTHER",
          game: "",
          units: "1",
          odds: "",
          bookmaker: "",
          placedAtLocal: DateTime.now().setZone(tz).toFormat("yyyy-MM-dd'T'HH:mm"),
          result: "PENDING",
        },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const json = draftToJson(d, tz);
    if (typeof json === "string") return setError(json);
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ bet: NbaBetDTO }>(bet ? `/api/nba/bets/${bet.id}` : "/api/nba/bets", { method: bet ? "PATCH" : "POST", json });
      onSaved(res.bet);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card w-full p-4" aria-label={bet ? "Edit NBA bet" : "Add an NBA bet"}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{bet ? "Edit bet" : "Add an NBA bet"}</h2>
        <button className="rounded-md p-1 text-muted hover:text-text" onClick={onClose} aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
      <NbaDatalists tipsters={tipsters} />
      <NbaFields d={d} onChange={(p) => setD((prev) => ({ ...prev, ...p }))} />
      {error && <p className="mt-2 text-xs text-under">{error}</p>}
      <div className="mt-3 flex items-center gap-2">
        <button className="btn-primary" disabled={busy} onClick={() => void save()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {bet ? "Save" : "Add bet"}
        </button>
        <button className="btn-ghost" disabled={busy} onClick={onClose}>
          Cancel
        </button>
      </div>
    </section>
  );
}
