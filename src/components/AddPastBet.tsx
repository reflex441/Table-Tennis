"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Plus, ScanText, X } from "lucide-react";
import { SlipScanner } from "./SlipScanner";
import { DateTime } from "luxon";
import { api } from "@/lib/client-api";
import { fromLocalInputValue } from "@/lib/format";
import { SELECTIONS, selectionName, type Selection } from "@/lib/selection";
import { round2 } from "@/lib/bets/profit";
import { useSettings } from "./SettingsProvider";
import { useNotifications } from "./NotificationProvider";
import { DateTimeInput } from "./DateTimeInput";
import { LeagueSelect } from "./LeagueSelect";

type Result = "WON" | "LOST" | "VOID" | "PENDING";

/**
 * Profit page: record bets on matches that were already played (no alarm),
 * typed in by hand or read from bookmaker bet-slip screenshots.
 */
export function AddPastBet() {
  const [open, setOpen] = useState<null | "form" | "slips">(null);
  if (open === "form") return <PastBetForm onClose={() => setOpen(null)} />;
  if (open === "slips") return <SlipScanner onClose={() => setOpen(null)} />;
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <button className="btn-ghost" onClick={() => setOpen("slips")}>
        <ScanText className="h-4 w-4" /> Scan bet slips
      </button>
      <button className="btn-ghost" onClick={() => setOpen("form")}>
        <Plus className="h-4 w-4" /> Add past bet
      </button>
    </div>
  );
}

function PastBetForm({ onClose }: { onClose: () => void }) {
  const { settings } = useSettings();
  const { notify } = useNotifications();
  const router = useRouter();
  const tz = settings.timezone;
  const [nowLocal] = useState(() => DateTime.now().setZone(tz).toFormat("yyyy-MM-dd'T'HH:mm"));
  const [f, setF] = useState({
    player1: "",
    player2: "",
    competition: "",
    startsAt: nowLocal,
    playType: "BOT" as "BOT" | "PERSONAL",
    selection: "" as "" | Selection,
    pointsLine: "",
    stake: "1",
    odds: "",
    result: "WON" as Result,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof f>) => setF((prev) => ({ ...prev, ...patch }));

  const save = async () => {
    const startsAt = fromLocalInputValue(f.startsAt, tz);
    const stake = Number(f.stake);
    const odds = f.odds.trim() ? Number(f.odds) : null;
    const line = f.pointsLine.trim() ? Number(f.pointsLine) : null;
    if (!f.player1.trim() || !f.player2.trim()) return setError("Enter both players.");
    if (!startsAt) return setError("Enter the date and time of the match.");
    if (new Date(startsAt).getTime() > Date.now()) return setError("That's in the future - add upcoming matches with Upload or Manual so you get the alarm.");
    if (!Number.isFinite(stake) || stake <= 0) return setError("Units must be a number above 0.");
    if (odds === null && f.result === "WON") return setError("Enter the odds so the profit of a win can be counted.");
    if (odds !== null && (!Number.isFinite(odds) || odds <= 1)) return setError("Odds must be decimal odds above 1.00 (e.g. 1.85).");
    if (line !== null && !Number.isFinite(line)) return setError("The line must be a number, e.g. 74.5 (or -4.5 for a spread).");
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ combined: boolean }>("/api/bets/past", {
        method: "POST",
        json: {
          player1: f.player1.trim(),
          player2: f.player2.trim(),
          competition: f.competition.trim() || null,
          startsAt,
          timezone: tz,
          playType: f.playType,
          selection: f.selection || null,
          pointsLine: line,
          stake: round2(stake),
          odds,
          result: f.result,
        },
      });
      notify(
        "Past bet added",
        res.combined
          ? `Added to your existing ${f.player1.trim()} vs ${f.player2.trim()} match as a split bet.`
          : `${f.player1.trim()} vs ${f.player2.trim()} is on your Profit page.`,
      );
      router.refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const seg = <T extends string>(value: T, options: readonly (readonly [T, string])[], onChange: (v: T) => void, label: string) => (
    <div className="flex rounded-lg border border-line p-0.5 text-xs" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          className={`rounded-md px-2.5 py-1 ${value === v ? "bg-panel-2 font-semibold text-text" : "text-muted hover:text-text"}`}
          onClick={() => onChange(v)}
        >
          {text}
        </button>
      ))}
    </div>
  );

  return (
    <section className="card w-full p-4" aria-label="Add a past bet">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Add a bet from a match that&apos;s already been played</h2>
        <button className="rounded-md p-1 text-muted hover:text-text" onClick={onClose} aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className="label">Player 1</span>
          <input className="input" value={f.player1} onChange={(e) => set({ player1: e.target.value })} aria-label="Player 1" />
        </label>
        <label>
          <span className="label">Player 2</span>
          <input className="input" value={f.player2} onChange={(e) => set({ player2: e.target.value })} aria-label="Player 2" />
        </label>
        <label>
          <span className="label">League</span>
          <LeagueSelect value={f.competition} onChange={(v) => set({ competition: v })} />
        </label>
        <div>
          <span className="label">Date and time</span>
          <DateTimeInput value={f.startsAt} max={nowLocal} onChange={(v) => set({ startsAt: v })} />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div>
          <span className="label">Play</span>
          {seg(f.playType, [["BOT", "Bot"], ["PERSONAL", "Personal"]] as const, (v) => set({ playType: v }), "Play type")}
        </div>
        <label className="w-40">
          <span className="label">Pick</span>
          <select className="input py-1.5" value={f.selection} onChange={(e) => set({ selection: e.target.value as "" | Selection })} aria-label="Pick">
            <option value="">—</option>
            {SELECTIONS.map((s) => (
              <option key={s} value={s}>
                {selectionName(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="w-24">
          <span className="label">Line</span>
          <input className="input py-1.5 tabular" inputMode="decimal" placeholder="74.5" value={f.pointsLine} onChange={(e) => set({ pointsLine: e.target.value })} aria-label="Points line" />
        </label>
        <label className="w-20">
          <span className="label">Units</span>
          <input className="input py-1.5 tabular" inputMode="decimal" value={f.stake} onChange={(e) => set({ stake: e.target.value })} aria-label="Units" />
        </label>
        <label className="w-24">
          <span className="label">Odds</span>
          <input className="input py-1.5 tabular" inputMode="decimal" placeholder="1.85" value={f.odds} onChange={(e) => set({ odds: e.target.value })} aria-label="Odds" />
        </label>
        <div>
          <span className="label">Result</span>
          {seg(f.result, [["WON", "Won"], ["LOST", "Lost"], ["VOID", "Void"], ["PENDING", "Not settled"]] as const, (v) => set({ result: v }), "Result")}
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-under">{error}</p>}
      <div className="mt-4 flex items-center gap-2">
        <button className="btn-primary" disabled={busy} onClick={() => void save()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Add bet
        </button>
        <button className="btn-ghost" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <span className="ml-auto text-[11px] text-muted">No alarm is set. It counts towards your profit straight away.</span>
      </div>
    </section>
  );
}
