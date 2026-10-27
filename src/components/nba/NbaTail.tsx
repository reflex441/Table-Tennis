"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Eye, Loader2 } from "lucide-react";
import { api } from "@/lib/client-api";
import { formatDayLabel } from "@/lib/format";
import { formatUnits, summarize, summarizeBy } from "@/lib/bets/profit";
import { NBA_MARKET_LABEL } from "@/lib/nba/parse";
import type { NbaTail, NbaTailBet } from "@/lib/nba/tailing";
import { ProfitAmount, ResultChip } from "../BetBits";
import { useSettings } from "../SettingsProvider";
import { useNotifications } from "../NotificationProvider";
import { BasketballIcon } from "./BasketballIcon";
import { SummaryCard, SummaryTable } from "./NbaPage";

/**
 * The owner's NBA picks on the Tailing page (for the accounts the owner
 * allowed): their record per tipster, open picks to copy to your NBA page,
 * and their settled picks.
 */
export function NbaTailView({ initial, ownerName }: { initial: NbaTail; ownerName: string }) {
  const { settings } = useSettings();
  const { notify } = useNotifications();
  const [nba, setNba] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const tz = settings.timezone;
  const { bets, isSelf } = nba;
  const open = bets.filter((b) => b.result === "PENDING");
  const notCopied = open.filter((b) => !b.copied);
  const settled = bets.filter((b) => b.result !== "PENDING").slice(0, 50);
  const summary = useMemo(() => summarize(bets), [bets]);
  const byTipster = useMemo(() => summarizeBy(bets, (b) => b.tipster), [bets]);

  const copy = async (ids: string[] | null, key: string) => {
    setBusy(key);
    try {
      const res = await api<{ copied: number; skipped: number; nba: NbaTail | null }>("/api/tailing/nba", { method: "POST", json: ids ? { ids } : {} });
      if (res.nba) setNba(res.nba);
      notify(
        res.copied ? `Copied ${res.copied} NBA pick${res.copied === 1 ? "" : "s"} to your NBA page` : "Nothing new to copy",
        res.skipped ? `${res.skipped} already on your NBA page.` : "",
        res.copied ? "/nba" : "",
      );
    } catch (err) {
      notify("Copy failed", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {isSelf && (
        <p className="flex items-start gap-2 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-accent">
          <Eye className="mt-0.5 h-4 w-4 shrink-0" />
          This is what accounts with NBA tailing see (Settings → Accounts). Your notes stay private.
        </p>
      )}

      <SummaryCard title={`${ownerName}'s NBA`} icon={<BasketballIcon className="h-4 w-4 text-orange-400" />} summary={summary} />

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
          <h2 className="text-sm font-semibold">
            Open picks <span className="font-normal text-muted">({open.length})</span>
          </h2>
          {open.length > 0 && !isSelf && (
            <button type="button" className="btn-primary px-3 py-1 text-xs" disabled={busy !== null || notCopied.length === 0} onClick={() => void copy(null, "all")}>
              {busy === "all" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
              {notCopied.length ? `Copy picks (${notCopied.length})` : "All copied"}
            </button>
          )}
        </div>
        {open.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted">No open NBA picks right now.</p>
        ) : (
          <ul className="divide-y divide-line">
            {open.map((b) => (
              <PickRow key={b.id} bet={b} tz={tz}>
                {isSelf ? null : b.copied ? (
                  <span className="chip gap-1 bg-over/15 text-over">
                    <Check className="h-3 w-3" /> On your NBA page
                  </span>
                ) : (
                  <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={busy !== null} onClick={() => void copy([b.id], b.id)}>
                    {busy === b.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />} Copy
                  </button>
                )}
              </PickRow>
            ))}
          </ul>
        )}
        {!isSelf && (
          <p className="border-t border-line px-3 py-2 text-[11px] text-muted">
            Copied picks go on your NBA page with the same units and odds, and are settled from ESPN like your own. You can edit them afterwards.
          </p>
        )}
      </section>

      {byTipster.length > 0 && (
        <section className="card overflow-hidden">
          <h2 className="border-b border-line px-3 py-2 text-sm font-semibold">By tipster</h2>
          <SummaryTable rows={byTipster} label="Tipster" />
        </section>
      )}

      <section className="card overflow-hidden">
        <h2 className="border-b border-line px-3 py-2 text-sm font-semibold">
          Settled picks <span className="font-normal text-muted">(latest {settled.length})</span>
        </h2>
        {settled.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted">No settled NBA picks yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {settled.map((b) => (
              <PickRow key={b.id} bet={b} tz={tz}>
                <ResultChip result={b.result} />
                {b.profit !== null && <ProfitAmount units={b.profit} />}
              </PickRow>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PickRow({ bet, tz, children }: { bet: NbaTailBet; tz: string; children: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
      <span className="w-24 shrink-0 text-xs text-muted">{formatDayLabel(bet.placedAt, tz)}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{bet.pick}</span>
        <span className="block truncate text-xs text-muted">
          <span className="text-text">{bet.tipster}</span> · {NBA_MARKET_LABEL[bet.market]}
          {bet.game ? ` · ${bet.game}` : ""}
          {bet.bookmaker ? ` · ${bet.bookmaker}` : ""}
        </span>
      </span>
      <span className="flex items-center gap-2 text-xs">
        <span className="chip bg-panel-2 font-semibold tabular text-text">{formatUnits(bet.stake, false)}</span>
        <span className="tabular text-muted">{bet.odds ? `@ ${bet.odds.toFixed(2)}` : ""}</span>
        {children}
      </span>
    </li>
  );
}
