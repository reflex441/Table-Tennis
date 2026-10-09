"use client";

import { useState } from "react";
import { Bot, Check, Pencil, RotateCcw, Split, User, X } from "lucide-react";
import type { MatchDTO } from "@/lib/types";
import { defaultStake, formatMoney, formatUnits, round2 } from "@/lib/bets/profit";
import { api } from "@/lib/client-api";
import { useSettings } from "./SettingsProvider";
import { SelectionBadge } from "./MatchBits";
import { SELECTIONS, selectionName, type Selection } from "@/lib/selection";
import { parseLegs, splitLegs, type LegDraft } from "@/lib/bets/split";

export { parseLegs, splitLegs, type LegDraft };

type Result = "PENDING" | "WON" | "LOST" | "VOID";

export function PlayTypeChip({ playType }: { playType: "BOT" | "PERSONAL" }) {
  return playType === "BOT" ? (
    <span className="chip gap-1 bg-violet-500/15 text-violet-300 ring-1 ring-violet-400/30" title="Bot play - the screenshot had an OVER / UNDER / SWEEP pick">
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

/** Units of the play: the recorded bet's stake, else what was set at upload (badge units), else 1u. */
export function playUnits(match: Pick<MatchDTO, "bet" | "stakeUnits">): number {
  return match.bet?.stake ?? defaultStake(match.stakeUnits);
}

/**
 * "Bet placed" confirmation: the units are filled in from the play, and the
 * odds you actually got must be entered (they start empty on purpose).
 */
export function PlacedForm({
  match,
  busy,
  onConfirm,
  onCancel,
}: {
  match: MatchDTO;
  busy: boolean;
  onConfirm: (bet: { stake: number; odds: number }) => void;
  onCancel: () => void;
}) {
  const [stake, setStake] = useState(String(playUnits(match)));
  const [odds, setOdds] = useState(match.bet?.odds ? String(match.bet.odds) : "");
  const [error, setError] = useState<string | null>(null);
  const hint = match.odds ? match.odds.toFixed(2) : "1.85";

  const confirm = () => {
    const s = Number(stake);
    const o = Number(odds);
    if (!Number.isFinite(s) || s <= 0) return setError("Units must be a number above 0.");
    if (!odds.trim() || !Number.isFinite(o) || o <= 1) return setError("Enter the odds you got (decimal, above 1.00).");
    onConfirm({ stake: round2(s), odds: o });
  };

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-over/40 bg-over/5 p-2" onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap items-end gap-2">
        <label className="w-20">
          <span className="label">Units</span>
          <input className="input py-1 tabular" inputMode="decimal" value={stake} onChange={(e) => setStake(e.target.value)} aria-label="Units" />
        </label>
        <label className="w-24">
          <span className="label">Odds *</span>
          <input
            className="input py-1 tabular"
            inputMode="decimal"
            placeholder={hint}
            value={odds}
            autoFocus
            onChange={(e) => setOdds(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && confirm()}
            aria-label="Odds you got"
          />
        </label>
        <button className="btn-ghost border-over/40 px-2 py-1 text-xs text-over hover:bg-over/10" disabled={busy} onClick={confirm}>
          <Check className="h-3.5 w-3.5" /> Confirm
        </button>
        <button className="btn-ghost px-2 py-1 text-xs" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error && <p className="text-[11px] text-under">{error}</p>}
    </div>
  );
}

/** Rows of pick / stake / odds inputs for a split bet. */
export function LegsEditor({ legs, onChange }: { legs: LegDraft[]; onChange: (legs: LegDraft[]) => void }) {
  const set = (i: number, patch: Partial<LegDraft>) => onChange(legs.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="flex flex-col gap-1.5">
      {legs.map((l, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2">
          <label className="w-36">
            <span className="label">Pick {i + 1}</span>
            <select className="input py-1" value={l.selection} onChange={(e) => set(i, { selection: e.target.value as Selection })} aria-label={`Pick ${i + 1}`}>
              {SELECTIONS.map((sel) => (
                <option key={sel} value={sel}>
                  {selectionName(sel)}
                </option>
              ))}
            </select>
          </label>
          <label className="w-20">
            <span className="label">Stake (u)</span>
            <input className="input py-1 tabular" inputMode="decimal" value={l.stake} onChange={(e) => set(i, { stake: e.target.value })} aria-label={`Pick ${i + 1} stake in units`} />
          </label>
          <label className="w-24">
            <span className="label">Odds</span>
            <input className="input py-1 tabular" inputMode="decimal" placeholder="1.85" value={l.odds} onChange={(e) => set(i, { odds: e.target.value })} aria-label={`Pick ${i + 1} decimal odds`} />
          </label>
          {legs.length > 2 && (
            <button className="btn-ghost px-1.5 py-1 text-xs" onClick={() => onChange(legs.filter((_, j) => j !== i))} aria-label={`Remove pick ${i + 1}`}>
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}
      {legs.length < 3 && (
        <button
          className="self-start text-[11px] text-accent hover:underline"
          onClick={() => onChange([...legs, { selection: SELECTIONS.find((s) => !legs.some((l) => l.selection === s)) ?? "OVER", stake: "", odds: "" }])}
        >
          + Add a pick
        </button>
      )}
    </div>
  );
}

type PlayType = "BOT" | "PERSONAL";

/** Bot / Personal switch for one pick of a split bet. */
function LegPlayType({ value, busy, label, onChange }: { value: PlayType; busy: boolean; label: string; onChange: (t: PlayType) => void }) {
  return (
    <span className="inline-flex rounded-md border border-line p-px text-[10px]" role="radiogroup" aria-label={`${label}: bot or personal play`}>
      {(["BOT", "PERSONAL"] as const).map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={value === t}
          disabled={busy}
          className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-semibold ${
            value === t ? (t === "BOT" ? "bg-violet-500/20 text-violet-300" : "bg-amber-500/15 text-amber-300") : "text-muted hover:text-text"
          }`}
          onClick={() => value !== t && onChange(t)}
          title={t === "BOT" ? "Count this pick as a bot play" : "Count this pick as a personal play"}
        >
          {t === "BOT" ? <Bot className="h-3 w-3" /> : <User className="h-3 w-3" />}
          {t === "BOT" ? "Bot" : "Personal"}
        </button>
      ))}
    </span>
  );
}

function SettleButtons({ busy, onSettle }: { busy: boolean; onSettle: (r: Result) => void }) {
  return (
    <>
      <button className="btn-ghost px-2 py-0.5 text-[11px] text-over" disabled={busy} onClick={() => onSettle("WON")}>
        <Check className="h-3 w-3" /> Won
      </button>
      <button className="btn-ghost px-2 py-0.5 text-[11px] text-under" disabled={busy} onClick={() => onSettle("LOST")}>
        <X className="h-3 w-3" /> Lost
      </button>
      <button className="btn-ghost px-2 py-0.5 text-[11px]" disabled={busy} onClick={() => onSettle("VOID")}>
        Void
      </button>
    </>
  );
}

/**
 * Bet line for a match: record the bet, enter stake (units) / odds and
 * settle it as Won / Lost / Void. A bet can be split over 2-3 picks (e.g.
 * 0.5u UNDER + 0.5u SWEEP), each settled on its own. Profit is shown in
 * units with the money amount next to it.
 */
export function BetPanel({ match, onChange }: { match: MatchDTO; onChange: (m: MatchDTO) => void }) {
  const bet = match.bet;
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stake, setStake] = useState("");
  const [odds, setOdds] = useState("");
  const [legs, setLegs] = useState<LegDraft[] | null>(null);

  const send = async (body: { stake?: number; odds?: number | null; result?: Result; legs?: unknown; leg?: { index: number; result?: Result; playType?: PlayType | null } } | null) => {
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
    setLegs(bet?.legs.length ? bet.legs.map((l) => ({ selection: l.selection, stake: String(l.stake), odds: l.odds ? String(l.odds) : "" })) : null);
    setError(null);
    setEditing(true);
  };

  const startSplit = () => {
    const total = Number(stake) > 0 ? Number(stake) : defaultStake(match.stakeUnits);
    setLegs(splitLegs(total, match.statistics.selection ?? "UNDER", odds));
  };
  const stopSplit = () => {
    const total = legs?.reduce((sum, l) => sum + (Number(l.stake) || 0), 0) ?? 0;
    if (total > 0) setStake(String(round2(total)));
    setLegs(null);
  };

  const saveEditor = async () => {
    if (legs) {
      const parsed = parseLegs(legs);
      if (typeof parsed === "string") return setError(parsed);
      if (await send({ legs: parsed })) setEditing(false);
      return;
    }
    const s = Number(stake);
    const o = odds.trim() ? Number(odds) : null;
    if (!Number.isFinite(s) || s <= 0) return setError("Stake must be a number of units above 0.");
    if (o !== null && (!Number.isFinite(o) || o <= 1)) return setError("Odds must be decimal odds above 1.00 (e.g. 1.85).");
    if (await send({ stake: round2(s), odds: o, ...(bet?.legs.length ? { legs: null } : {}) })) setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex flex-col gap-1.5 rounded-lg border border-line bg-bg/60 p-2">
        {legs ? (
          <>
            <LegsEditor legs={legs} onChange={setLegs} />
            <button className="self-start text-[11px] text-muted hover:text-text hover:underline" onClick={stopSplit}>
              Don&apos;t split - one pick
            </button>
          </>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <label className="w-20">
              <span className="label">Stake (u)</span>
              <input className="input py-1 tabular" inputMode="decimal" value={stake} onChange={(e) => setStake(e.target.value)} aria-label="Stake in units" />
            </label>
            <label className="w-24">
              <span className="label">Odds</span>
              <input className="input py-1 tabular" inputMode="decimal" placeholder="1.85" value={odds} onChange={(e) => setOdds(e.target.value)} aria-label="Decimal odds" />
            </label>
            <button className="btn-ghost px-2 py-1 text-xs" onClick={startSplit} title="Bet on 2 or 3 picks, e.g. half on Under and half on Sweep">
              <Split className="h-3.5 w-3.5" /> Split between picks
            </button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
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

  if (bet.legs.length) {
    const anySettled = bet.legs.some((l) => l.result !== "PENDING");
    return (
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <button className="inline-flex items-center gap-1 text-muted hover:text-text" onClick={openEditor} aria-label="Edit bet">
            Split bet <span className="tabular text-text">{formatUnits(bet.stake, false)}</span>
            <Pencil className="h-3 w-3" />
          </button>
          <ResultChip result={bet.result} />
          {settled && bet.profit !== null && <ProfitAmount units={bet.profit} />}
          <span className="ml-auto flex items-center gap-1">
            {anySettled && (
              <button className="btn-ghost px-1.5 py-0.5 text-[11px]" disabled={busy} onClick={() => send({ result: "PENDING" })} aria-label="Mark all picks as pending">
                <RotateCcw className="h-3 w-3" />
              </button>
            )}
          </span>
        </div>
        <ul className="flex flex-col gap-1 border-l-2 border-line pl-2">
          {bet.legs.map((l, i) => (
            <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <SelectionBadge selection={l.selection} pointsLine={l.selection === match.statistics.selection ? match.statistics.pointsLine : null} />
              <LegPlayType
                value={l.playType ?? match.playType}
                busy={busy}
                label={`Pick ${i + 1}`}
                // Same as the match: follow it (null), so changing the match changes this pick too.
                onChange={(t) => void send({ leg: { index: i, playType: t === match.playType ? null : t } })}
              />
              <span className="tabular text-text">{formatUnits(l.stake, false)}</span>
              {l.odds ? <span className="tabular text-muted">@ {l.odds.toFixed(2)}</span> : <span className="text-warn">add odds</span>}
              {l.result !== "PENDING" && <ResultChip result={l.result} />}
              {l.result !== "PENDING" && l.profit !== null && <ProfitAmount units={l.profit} />}
              <span className="ml-auto flex items-center gap-1">
                {l.result === "PENDING" ? (
                  <SettleButtons busy={busy} onSettle={(result) => void send({ leg: { index: i, result } })} />
                ) : (
                  <button className="btn-ghost px-1.5 py-0.5 text-[11px]" disabled={busy} onClick={() => send({ leg: { index: i, result: "PENDING" } })} aria-label={`Mark pick ${i + 1} as pending`}>
                    <RotateCcw className="h-3 w-3" />
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
        {bet.result === "WON" && bet.profit === null && <span className="text-[11px] text-warn">Add the odds of the won pick to count the profit</span>}
        {error && <p className="text-[11px] text-under">{error}</p>}
      </div>
    );
  }

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
            <SettleButtons busy={busy} onSettle={(result) => void send({ result })} />
          )}
        </span>
      </div>
      {error && <p className="text-[11px] text-under">{error}</p>}
    </div>
  );
}
