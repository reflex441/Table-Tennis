"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCircle2, ImagePlus, Loader2, TriangleAlert, X } from "lucide-react";
import { api, uploadWithProgress } from "@/lib/client-api";
import { fromLocalInputValue, toLocalInputValue } from "@/lib/format";
import { prepareUpload } from "@/lib/shrink-image";
import { SELECTIONS, type Selection } from "@/lib/selection";
import { round2 } from "@/lib/bets/profit";
import type { SlipBet, SlipResult } from "@/lib/gemini/betslip";
import { useSettings } from "./SettingsProvider";
import { useNotifications } from "./NotificationProvider";
import { DateTimeInput } from "./DateTimeInput";
import { LeagueSelect } from "./LeagueSelect";

interface Row {
  key: string;
  include: boolean;
  player1: string;
  player2: string;
  competition: string;
  /** The league was guessed from the players' past matches. */
  leagueGuessed: boolean;
  startsAtLocal: string;
  playType: "BOT" | "PERSONAL";
  selection: "" | Selection;
  pointsLine: string;
  units: string;
  odds: string;
  result: SlipResult;
  resultText: string | null;
  status: null | { ok: boolean; message: string };
}

const RESULT_LABEL: Record<SlipResult, string> = { WON: "Won", LOST: "Lost", VOID: "Void", PENDING: "Not settled" };

type ScannedBet = SlipBet & { startsAt: string | null; competitionGuessed?: boolean };

let counter = 0;

/**
 * Upload bookmaker bet-slip screenshots ("Win" / "No Return"), check the
 * bets that were read, and add them to the Profit page as past bets.
 */
export function SlipScanner({ onClose }: { onClose: () => void }) {
  const { settings } = useSettings();
  const { notify } = useNotifications();
  const router = useRouter();
  const tz = settings.timezone;
  const input = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [scanning, setScanning] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [playType, setPlayType] = useState<"BOT" | "PERSONAL">("BOT");

  const patch = (key: string, p: Partial<Row>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const toRow = (b: ScannedBet): Row => ({
    key: `slip${++counter}`,
    include: true,
    player1: b.player1 ?? "",
    player2: b.player2 ?? "",
    competition: b.competition ?? "",
    leagueGuessed: Boolean(b.competitionGuessed && b.competition),
    startsAtLocal: b.startsAt ? toLocalInputValue(b.startsAt, tz) : "",
    playType,
    selection: b.selection ?? "",
    pointsLine: b.pointsLine !== null ? String(b.pointsLine) : "",
    // Stake in money -> units with your unit size.
    units: b.stake !== null && settings.unitSize > 0 ? String(round2(b.stake / settings.unitSize)) : "1",
    odds: b.odds !== null ? String(b.odds) : "",
    result: b.result,
    resultText: b.resultText,
    status: null,
  });

  const scan = async (files: FileList | null) => {
    if (!files?.length) return;
    setErrors([]);
    for (const original of Array.from(files)) {
      setScanning((n) => n + 1);
      try {
        const { file } = await prepareUpload(original);
        const form = new FormData();
        form.append("file", file);
        const res = await uploadWithProgress<{ bets: ScannedBet[] }>("/api/bets/scan", form, () => {});
        if (!res.bets.length) setErrors((e) => [...e, `${original.name}: no bets found.`]);
        setRows((prev) => [...prev, ...res.bets.map(toRow)]);
      } catch (err) {
        setErrors((e) => [...e, `${original.name}: ${err instanceof Error ? err.message : String(err)}`]);
      } finally {
        setScanning((n) => n - 1);
      }
    }
  };

  const validate = (r: Row): string | null => {
    if (!r.player1.trim() || !r.player2.trim()) return "Enter both players.";
    const iso = fromLocalInputValue(r.startsAtLocal, tz);
    if (!iso) return "Enter the date and time.";
    if (new Date(iso).getTime() > Date.now()) return "Date is in the future.";
    const units = Number(r.units);
    if (!Number.isFinite(units) || units <= 0) return "Units must be above 0.";
    const odds = r.odds.trim() ? Number(r.odds) : null;
    if (odds === null && r.result === "WON") return "Enter the odds of the win.";
    if (odds !== null && (!Number.isFinite(odds) || odds <= 1)) return "Odds must be above 1.00.";
    return null;
  };

  const addAll = async () => {
    const todo = rows.filter((r) => r.include && !r.status?.ok);
    let added = 0;
    setAdding(true);
    for (const r of todo) {
      const problem = validate(r);
      if (problem) {
        patch(r.key, { status: { ok: false, message: problem } });
        continue;
      }
      try {
        const res = await api<{ combined: boolean }>("/api/bets/past", {
          method: "POST",
          json: {
            player1: r.player1.trim(),
            player2: r.player2.trim(),
            competition: r.competition.trim() || null,
            startsAt: fromLocalInputValue(r.startsAtLocal, tz),
            timezone: tz,
            playType: r.playType,
            selection: r.selection || null,
            pointsLine: r.pointsLine.trim() ? Number(r.pointsLine) : null,
            stake: round2(Number(r.units)),
            odds: r.odds.trim() ? Number(r.odds) : null,
            result: r.result,
          },
        });
        added++;
        patch(r.key, { status: { ok: true, message: res.combined ? "Added to the same match (split bet)" : "Added" } });
      } catch (err) {
        patch(r.key, { status: { ok: false, message: err instanceof Error ? err.message : String(err) } });
      }
    }
    setAdding(false);
    if (added) {
      notify(`Added ${added} past bet${added === 1 ? "" : "s"}`, "They're on your Profit page.");
      router.refresh();
    }
  };

  const pending = rows.filter((r) => r.include && !r.status?.ok).length;

  return (
    <section className="card w-full p-4" aria-label="Scan bet slips">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Scan bet slips</h2>
        <button className="rounded-md p-1 text-muted hover:text-text" onClick={onClose} aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="text-xs text-muted">
        Upload screenshots of your settled bets from Ladbrokes or Sportsbet. <span className="text-text">Win</span> is counted as won and{" "}
        <span className="text-text">No Return</span> as lost. Stakes are turned into units with your unit size ({settings.currency}
        {settings.unitSize} = 1u). Check the bets, then add them.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/heic,image/heif" multiple hidden onChange={(e) => void scan(e.target.files).then(() => (e.target.value = ""))} />
        <button className="btn-primary" onClick={() => input.current?.click()} disabled={scanning > 0}>
          {scanning > 0 ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
          {scanning > 0 ? `Reading ${scanning} screenshot${scanning === 1 ? "" : "s"}…` : "Choose screenshots"}
        </button>
        <span className="ml-auto flex items-center gap-2 text-xs text-muted">
          These bets are
          <span className="flex rounded-lg border border-line p-0.5" role="radiogroup" aria-label="Play type for new rows">
            {(["BOT", "PERSONAL"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={playType === t}
                className={`rounded-md px-2 py-0.5 ${playType === t ? "bg-panel-2 font-semibold text-text" : "hover:text-text"}`}
                onClick={() => {
                  setPlayType(t);
                  setRows((prev) => prev.map((r) => (r.status?.ok ? r : { ...r, playType: t })));
                }}
              >
                {t === "BOT" ? "Bot plays" : "Personal plays"}
              </button>
            ))}
          </span>
        </span>
      </div>

      {errors.map((e) => (
        <p key={e} className="mt-2 flex items-start gap-1.5 text-xs text-under">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {e}
        </p>
      ))}


      {rows.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {rows.map((r) => (
            <div key={r.key} className={`rounded-lg border p-2 ${r.status?.ok ? "border-over/40 bg-over/5" : "border-line"} ${r.include ? "" : "opacity-50"}`}>
              <div className="flex flex-wrap items-end gap-2 text-xs">
                <label className="flex items-center gap-1.5 self-center">
                  <input type="checkbox" checked={r.include} disabled={r.status?.ok} onChange={(e) => patch(r.key, { include: e.target.checked })} aria-label="Include this bet" />
                </label>
                <label className="min-w-32 flex-1">
                  <span className="label">Player 1</span>
                  <input className="input py-1" value={r.player1} onChange={(e) => patch(r.key, { player1: e.target.value })} aria-label="Player 1" />
                </label>
                <label className="min-w-32 flex-1">
                  <span className="label">Player 2</span>
                  <input className="input py-1" value={r.player2} onChange={(e) => patch(r.key, { player2: e.target.value })} aria-label="Player 2" />
                </label>
                <label className="w-40">
                  <span className="label">League</span>
                  <LeagueSelect className="input py-1" value={r.competition} onChange={(v) => patch(r.key, { competition: v, leagueGuessed: false })} />
                  <span className="mt-0.5 block text-[11px] text-muted">{r.leagueGuessed ? "From past matches" : "\u00a0"}</span>
                </label>
                <div>
                  <span className="label">Date and time</span>
                  <DateTimeInput value={r.startsAtLocal} onChange={(v) => patch(r.key, { startsAtLocal: v })} compact />
                </div>
              </div>
              <div className="mt-1.5 flex flex-wrap items-end gap-2 text-xs">
                <label className="w-24">
                  <span className="label">Play</span>
                  <select className="input py-1" value={r.playType} onChange={(e) => patch(r.key, { playType: e.target.value as Row["playType"] })} aria-label="Play type">
                    <option value="BOT">Bot</option>
                    <option value="PERSONAL">Personal</option>
                  </select>
                </label>
                <label className="w-24">
                  <span className="label">Pick</span>
                  <select className="input py-1" value={r.selection} onChange={(e) => patch(r.key, { selection: e.target.value as Row["selection"] })} aria-label="Pick">
                    <option value="">—</option>
                    {SELECTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="w-20">
                  <span className="label">Line</span>
                  <input className="input py-1 tabular" inputMode="decimal" value={r.pointsLine} onChange={(e) => patch(r.key, { pointsLine: e.target.value })} aria-label="Points line" />
                </label>
                <label className="w-20">
                  <span className="label">Units</span>
                  <input className="input py-1 tabular" inputMode="decimal" value={r.units} onChange={(e) => patch(r.key, { units: e.target.value })} aria-label="Units" />
                </label>
                <label className="w-20">
                  <span className="label">Odds</span>
                  <input className="input py-1 tabular" inputMode="decimal" value={r.odds} onChange={(e) => patch(r.key, { odds: e.target.value })} aria-label="Odds" />
                </label>
                <label className="w-28">
                  <span className="label">Result</span>
                  <select className="input py-1" value={r.result} onChange={(e) => patch(r.key, { result: e.target.value as SlipResult })} aria-label="Result">
                    {(Object.keys(RESULT_LABEL) as SlipResult[]).map((k) => (
                      <option key={k} value={k}>
                        {RESULT_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </label>
                {r.resultText && <span className="self-center text-[11px] text-muted">Slip says &quot;{r.resultText}&quot;</span>}
                {r.status && (
                  <span className={`ml-auto flex items-center gap-1 self-center text-[11px] ${r.status.ok ? "text-over" : "text-under"}`}>
                    {r.status.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <TriangleAlert className="h-3.5 w-3.5" />} {r.status.message}
                  </span>
                )}
              </div>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <button className="btn-primary" disabled={adding || pending === 0} onClick={() => void addAll()}>
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Add {pending} bet{pending === 1 ? "" : "s"}
            </button>
            <button className="btn-ghost" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
