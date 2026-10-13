"use client";

import { useRef, useState } from "react";
import { Check, CheckCircle2, ImagePlus, Loader2, TriangleAlert, X } from "lucide-react";
import { DateTime } from "luxon";
import { api, uploadWithProgress } from "@/lib/client-api";
import { toLocalInputValue } from "@/lib/format";
import { prepareUpload } from "@/lib/shrink-image";
import type { ScannedPick } from "@/lib/gemini/nba";
import type { NbaBetDTO } from "@/lib/nba/service";
import { useSettings } from "../SettingsProvider";
import { NbaDatalists, NbaFields, draftToJson, type NbaDraft } from "./NbaBetForm";
import { statCode } from "@/lib/nba/stats";

type Scanned = ScannedPick & { tipster: string | null; bookmaker: string | null; odds: number | null; placedAt: string | null; dateKind?: "GAME" | "POSTED" };

interface Row {
  key: string;
  include: boolean;
  draft: NbaDraft;
  /** What the screenshot showed, for checking. */
  seen: string;
  status: null | { ok: boolean; message: string };
}

let counter = 0;

/**
 * Screenshots of tipsters' NBA picks (Discord messages, bet slips) -> bets
 * to check and add: tipster from the sender, units, odds, bookmaker, date.
 */
export function NbaScanner({ tipsters, onAdded, onClose }: { tipsters: string[]; onAdded: (bets: NbaBetDTO[]) => void; onClose: () => void }) {
  const { settings } = useSettings();
  const tz = settings.timezone;
  const input = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [scanning, setScanning] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);

  const patch = (key: string, p: Partial<Row>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const patchDraft = (key: string, p: Partial<NbaDraft>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, draft: { ...r.draft, ...p }, status: null } : r)));

  const toRow = (b: Scanned): Row => ({
    key: `nba${++counter}`,
    include: true,
    draft: {
      tipster: b.tipster ?? "",
      pick: b.pick,
      market: b.market,
      game: b.game ?? "",
      units: b.units !== null ? String(b.units) : "1",
      odds: b.odds !== null ? String(b.odds) : "",
      bookmaker: b.bookmaker ?? "",
      placedAtLocal: b.placedAt ? toLocalInputValue(b.placedAt, tz) : DateTime.now().setZone(tz).toFormat("yyyy-MM-dd'T'HH:mm"),
      dateKind: b.dateKind ?? "GAME",
      result: "PENDING",
      team: b.team ?? "",
      player: b.player ?? "",
      stat: statCode(b.stat) ?? b.stat ?? "",
      line: b.line !== null ? String(b.line) : "",
      side: b.side ?? "",
    },
    seen: [
      b.sender && `Sent by ${b.sender}`,
      b.oddsText && `odds ${b.oddsText}`,
      b.bookmakerText && `on ${b.bookmakerText}`,
      b.gameTimeText ? `game ${b.gameTimeText}` : b.postedText && `posted ${b.postedText} (no game day shown - the result comes from the next game after the post, and the date updates once it's found)`,
    ]
      .filter(Boolean)
      .join(" · "),
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
        const res = await uploadWithProgress<{ bets: Scanned[] }>("/api/nba/scan", form, () => {});
        if (!res.bets.length) setErrors((e) => [...e, `${original.name}: no picks found.`]);
        setRows((prev) => [...prev, ...res.bets.map(toRow)]);
      } catch (err) {
        setErrors((e) => [...e, `${original.name}: ${err instanceof Error ? err.message : String(err)}`]);
      } finally {
        setScanning((n) => n - 1);
      }
    }
  };

  const addAll = async () => {
    const todo = rows.filter((r) => r.include && !r.status?.ok);
    const added: NbaBetDTO[] = [];
    setAdding(true);
    for (const r of todo) {
      const json = draftToJson(r.draft, tz);
      if (typeof json === "string") {
        patch(r.key, { status: { ok: false, message: json } });
        continue;
      }
      try {
        const res = await api<{ bet: NbaBetDTO }>("/api/nba/bets", { method: "POST", json });
        added.push(res.bet);
        patch(r.key, { status: { ok: true, message: "Added" } });
      } catch (err) {
        patch(r.key, { status: { ok: false, message: err instanceof Error ? err.message : String(err) } });
      }
    }
    setAdding(false);
    if (added.length) onAdded(added);
  };

  const pending = rows.filter((r) => r.include && !r.status?.ok).length;

  return (
    <section className="card w-full p-4" aria-label="Scan NBA picks">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Scan picks</h2>
        <button className="rounded-md p-1 text-muted hover:text-text" onClick={onClose} aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="text-xs text-muted">
        Screenshot a tipster&apos;s message (e.g. on Discord). Each bet is read with its units, odds and bookmaker; the tipster comes from who sent it (Winible =
        ADP - change these in Settings → NBA). American odds (+138) are turned into decimal (2.38). Check them, then add.
      </p>
      <NbaDatalists tipsters={tipsters} />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/heic,image/heif" multiple hidden onChange={(e) => void scan(e.target.files).then(() => (e.target.value = ""))} />
        <button className="btn-primary" onClick={() => input.current?.click()} disabled={scanning > 0}>
          {scanning > 0 ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
          {scanning > 0 ? `Reading ${scanning} screenshot${scanning === 1 ? "" : "s"}…` : "Choose screenshots"}
        </button>
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
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-6"
                  checked={r.include}
                  disabled={r.status?.ok}
                  onChange={(e) => patch(r.key, { include: e.target.checked })}
                  aria-label="Include this bet"
                />
                <div className="min-w-0 flex-1">
                  <NbaFields d={r.draft} onChange={(p) => patchDraft(r.key, p)} compact />
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
                    {r.seen && <span>Screenshot: {r.seen}</span>}
                    {r.status && (
                      <span className={`inline-flex items-center gap-1 ${r.status.ok ? "text-over" : "text-under"}`}>
                        {r.status.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <TriangleAlert className="h-3.5 w-3.5" />}
                        {r.status.message}
                      </span>
                    )}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <div className="mt-3 flex items-center gap-2">
          <button className="btn-primary" disabled={adding || pending === 0} onClick={() => void addAll()}>
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Add {pending} bet{pending === 1 ? "" : "s"}
          </button>
          <button className="btn-ghost" onClick={onClose}>
            Done
          </button>
        </div>
      )}
    </section>
  );
}
