"use client";

import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { DateTime } from "luxon";
import { api } from "@/lib/client-api";
import { fromLocalInputValue, toLocalInputValue } from "@/lib/format";
import { round2, type BetResult } from "@/lib/bets/profit";
import { NBA_MARKETS, NBA_MARKET_LABEL, parseOdds, type NbaMarket } from "@/lib/nba/parse";
import { STAT_CODES, STAT_LABEL, statCode } from "@/lib/nba/stats";
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
  /** For automatic results: team, player, stat code, line, side. */
  team: string;
  player: string;
  stat: string;
  line: string;
  side: "" | "OVER" | "UNDER";
}

export const EMPTY_GRADING = { team: "", player: "", stat: "", line: "", side: "" as const };

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
    team: b.team ?? "",
    player: b.player ?? "",
    stat: statCode(b.stat) ?? b.stat ?? "",
    line: b.line !== null ? String(b.line) : "",
    side: b.side ?? "",
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
  if (!placedAt) return "Enter the game date.";
  const line = d.line.trim() ? Number(d.line) : null;
  if (line !== null && !Number.isFinite(line)) return "The line must be a number, e.g. 1.5 or -4.5.";
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
    team: d.team.trim() || null,
    player: d.player.trim() || null,
    stat: d.stat.trim() || null,
    line,
    side: d.side || null,
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
          <span className="label">Game date</span>
          <DateTimeInput value={d.placedAtLocal} onChange={(v) => onChange({ placedAtLocal: v })} label="Game date" compact={compact} />
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
      <GradingFields d={d} onChange={onChange} pad={pad} />
      {!compact && (
        <label>
          <span className="label">Game (optional)</span>
          <input className="input py-1.5" value={d.game} onChange={(e) => onChange({ game: e.target.value })} placeholder="New York Knicks @ San Antonio Spurs" aria-label="Game" />
        </label>
      )}
    </div>
  );
}

/** What a result is worked out from, depending on the market (player prop: player, stat, line, side...). */
function GradingFields({ d, onChange, pad }: { d: NbaDraft; onChange: (patch: Partial<NbaDraft>) => void; pad: string }) {
  const prop = d.market === "PLAYER_PROP";
  const team = prop || d.market === "MONEYLINE" || d.market === "SPREAD" || d.market === "TOTAL";
  const line = prop || d.market === "SPREAD" || d.market === "TOTAL";
  const side = prop || d.market === "TOTAL";
  if (!team) return <p className="text-[11px] text-muted">{NBA_MARKET_LABEL[d.market]} bets are marked Won / Lost by you.</p>;
  const known = statCode(d.stat);
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-line px-2 py-1.5" aria-label="Details for automatic results">
      {prop && (
        <label className="w-40">
          <span className="label">Player</span>
          <input className={`input ${pad}`} value={d.player} onChange={(e) => onChange({ player: e.target.value })} placeholder="De'Aaron Fox" aria-label="Player" />
        </label>
      )}
      <label className="w-36">
        <span className="label">{d.market === "TOTAL" ? "Team (either)" : prop ? "Team (optional)" : "Team bet on"}</span>
        <input className={`input ${pad}`} value={d.team} onChange={(e) => onChange({ team: e.target.value })} placeholder={d.market === "SPREAD" ? "Celtics" : "Knicks"} aria-label="Team" />
      </label>
      {prop && (
        <label className="w-36">
          <span className="label">Stat</span>
          <select className={`input ${pad}`} value={known ?? d.stat} onChange={(e) => onChange({ stat: e.target.value })} aria-label="Stat">
            <option value="">—</option>
            {STAT_CODES.map((c) => (
              <option key={c} value={c}>
                {c} · {STAT_LABEL[c]}
              </option>
            ))}
            {!known && d.stat && <option value={d.stat}>{d.stat}</option>}
          </select>
        </label>
      )}
      {line && (
        <label className="w-20">
          <span className="label">{d.market === "SPREAD" ? "Spread" : "Line"}</span>
          <input className={`input ${pad} tabular`} inputMode="decimal" value={d.line} onChange={(e) => onChange({ line: e.target.value })} placeholder={d.market === "SPREAD" ? "-4.5" : d.market === "TOTAL" ? "220.5" : "1.5"} aria-label="Line" />
        </label>
      )}
      {side && (
        <label className="w-24">
          <span className="label">Over / Under</span>
          <select className={`input ${pad}`} value={d.side} onChange={(e) => onChange({ side: e.target.value as NbaDraft["side"] })} aria-label="Over or under">
            <option value="">—</option>
            <option value="OVER">Over</option>
            <option value="UNDER">Under</option>
          </select>
        </label>
      )}
      <span className="pb-1.5 text-[10px] text-muted">Used to mark it automatically from ESPN</span>
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
          ...EMPTY_GRADING,
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
