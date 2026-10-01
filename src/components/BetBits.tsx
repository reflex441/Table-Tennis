"use client";

import { useState } from "react";
import { Bot, Check, Pencil, RotateCcw, User, X } from "lucide-react";
import type { MatchDTO } from "@/lib/types";
import { defaultStake, formatMoney, formatUnits, round2 } from "@/lib/bets/profit";
import { api } from "@/lib/client-api";
import { useSettings } from "./SettingsProvider";

type Result = "PENDING" | "WON" | "LOST" | "VOID";

export function PlayTypeChip({ playType }: { playType: "BOT" | "PERSONAL" }) {
  return playType === "BOT" ? (
    <span className="chip gap-1 bg-violet-500/15 text-violet-300 ring-1 ring-violet-400/30" title="Bot play - the screenshot had an OVER/UNDER pick">
      <Bot className="h-3 w-3" /> BOT
    </span>
  ) : (
    <span className="chip gap-1 bg-amber-500/10 text-amber-300 ring-1 ring-amber-400/25" title="Personal play - no pick on the screenshot">
      <User className="h-3 w-3" /> PERSONAL
    </span>
  );
}

/** Profit in units, with the money amount (units × unit size) to its right. */
export function ProfitAmount({ units, size = "sm", signed = true }: { units: number | null | undefined; size?: "sm" | "lg"; signed?: boolean }) {
  const { settings } = useSettings();
  const tone = units === null || units === undefined || !signed ? "text-text" : units > 0 ? "text-over" : units < 0 ? "text-under" : "text-muted";
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <span className={`tabular font-semibold ${tone} ${size === "lg" ? "text-2xl" : ""}`}>{formatUnits(units, signed)}</span>
      <span className={`tabular text-muted ${size === "lg" ? "text-sm" : "text-[11px]"}`}>{formatMoney(units, settings.unitSize, settings.currency, signed)}</span>
    </span>
  );
}

const RESULT_STYLE: Record<Result, string> = {
  PENDING: "bg-accent/15 text-accent",
  WON: "bg-over/15 text-over",
  LOST: "bg-under/15 text-under",
  VOID: "bg-line text-muted",
};

export function ResultChip({ result }: { result: Result }) {
  return <span className={`chip ${RESULT_STYLE[result]}`}>{result === "PENDING" ? "Pending" : result === "WON" ? "Won" : result === "LOST" ? "Lost" : "Void"}</span>;
}

/**
 * Bet line for a match: record the bet, enter stake (units) / odds and
 * settle it as Won / Lost / Void. Profit is shown in units with the money
 * amount next to it.
 */
export function BetPanel({ match, onChange }: { match: MatchDTO; onChange: (m: MatchDTO) => void }) {
  const bet = match.bet;
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stake, setStake] = useState("");
  const [odds, setOdds] = useState("");

  const send = async (body: { stake?: number; odds?: number | null; result?: Result } | null) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ match: MatchDTO }>(`/api/matches/${match.id}/bet`, body ? { method: "PUT", json: body } : { method: "DELETE" });
      onChange(res.match);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openEditor = () => {
    setStake(String(bet?.stake ?? defaultStake(match.stakeUnits)));
    // Odds filled in at upload (e.g. the average odds) are the default.
    const o = bet ? bet.odds : match.odds;
    setOdds(o ? String(o) : "");
    setError(null);
    setEditing(true);
  };

  const saveEditor = async () => {
    const s = Number(stake);
    const o = odds.trim() ? Number(odds) : null;
    if (!Number.isFinite(s) || s <= 0) return setError("Stake must be a number of units above 0.");
    if (o !== null && (!Number.isFinite(o) || o <= 1)) return setError("Odds must be decimal odds above 1.00 (e.g. 1.85).");
    if (await send({ stake: round2(s), odds: o })) setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex flex-col gap-1.5 rounded-lg border border-line bg-bg/60 p-2">
        <div className="flex flex-wrap items-end gap-2">
          <label className="w-20">
            <span className="label">Stake (u)</span>
            <input className="input py-1 tabular" inputMode="decimal" value={stake} onChange={(e) => setStake(e.target.value)} aria-label="Stake in units" />
          </label>
          <label className="w-24">
            <span className="label">Odds</span>
            <input className="input py-1 tabular" inputMode="decimal" placeholder="1.85" value={odds} onChange={(e) => setOdds(e.target.value)} aria-label="Decimal odds" />
          </label>
          <button className="btn-primary px-2 py-1 text-xs" disabled={busy} onClick={saveEditor}>
            <Check className="h-3.5 w-3.5" /> Save
          </button>
          <button className="btn-ghost px-2 py-1 text-xs" disabled={busy} onClick={() => setEditing(false)}>
            Cancel
          </button>
          {bet && (
            <button
              className="btn-danger ml-auto px-2 py-1 text-xs"
              disabled={busy}
              onClick={async () => {
                if (window.confirm("Remove this bet from profit tracking?") && (await send(null))) setEditing(false);
              }}
            >
              Remove bet
            </button>
          )}
        </div>
        {error && <p className="text-[11px] text-under">{error}</p>}
      </div>
    );
  }

  if (!bet) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted">No bet recorded</span>
        <button className="btn-ghost px-2 py-0.5 text-xs" onClick={openEditor}>
          + Record bet
        </button>
      </div>
    );
  }

  const settled = bet.result !== "PENDING";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <button className="inline-flex items-center gap-1 text-muted hover:text-text" onClick={openEditor} aria-label="Edit bet">
          Bet <span className="tabular text-text">{formatUnits(bet.stake, false)}</span>
          {bet.odds ? (
            <>
              @ <span className="tabular text-text">{bet.odds.toFixed(2)}</span>
            </>
          ) : (
            <span className="text-warn">· add odds</span>
          )}
          <Pencil className="h-3 w-3" />
        </button>
        <ResultChip result={bet.result} />
        {settled && bet.profit !== null && <ProfitAmount units={bet.profit} />}
        {bet.result === "WON" && bet.profit === null && <span className="text-[11px] text-warn">Add the odds to count the profit</span>}
        <span className="ml-auto flex items-center gap-1">
          {settled ? (
            <button className="btn-ghost px-1.5 py-0.5 text-[11px]" disabled={busy} onClick={() => send({ result: "PENDING" })} aria-label="Mark as pending">
              <RotateCcw className="h-3 w-3" />
            </button>
          ) : (
            <>
              <button className="btn-ghost px-2 py-0.5 text-[11px] text-over" disabled={busy} onClick={() => send({ result: "WON" })}>
                <Check className="h-3 w-3" /> Won
              </button>
              <button className="btn-ghost px-2 py-0.5 text-[11px] text-under" disabled={busy} onClick={() => send({ result: "LOST" })}>
                <X className="h-3 w-3" /> Lost
              </button>
              <button className="btn-ghost px-2 py-0.5 text-[11px]" disabled={busy} onClick={() => send({ result: "VOID" })}>
                Void
              </button>
            </>
          )}
        </span>
      </div>
      {error && <p className="text-[11px] text-under">{error}</p>}
    </div>
  );
}
