"use client";

import Link from "next/link";
import { useState } from "react";
import { Loader2, UserMinus, UserPlus } from "lucide-react";
import type { TailAccount } from "@/lib/tailing";
import { api } from "@/lib/client-api";
import { Avatar } from "./Avatar";
import { ProfitAmount } from "./BetBits";

const pct = (n: number | null) => (n === null ? "–" : `${n > 0 ? "+" : ""}${n}%`);

/** Tail / untail an account. */
export function TailButton({ accountId, tailed, onChange, size = "sm" }: { accountId: string; tailed: boolean; onChange: (tailed: boolean) => void; size?: "sm" | "md" }) {
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try {
      await api(`/api/tailing/${accountId}`, { method: tailed ? "DELETE" : "POST" });
      onChange(!tailed);
    } finally {
      setBusy(false);
    }
  };
  const cls = size === "sm" ? "px-2 py-1 text-xs" : "";
  return (
    <button type="button" disabled={busy} onClick={() => void toggle()} className={`${tailed ? "btn-ghost" : "btn-primary"} ${cls}`}>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : tailed ? <UserMinus className="h-3.5 w-3.5" /> : <UserPlus className="h-3.5 w-3.5" />}
      {tailed ? "Untail" : "Tail"}
    </button>
  );
}

export function TailAccountCard({ account, onChange }: { account: TailAccount; onChange: (tailed: boolean) => void }) {
  const s = account.summary;
  return (
    <div className="card flex flex-col gap-2 p-3">
      <div className="flex items-center gap-3">
        <Avatar name={account.name} url={account.avatarUrl} size={40} />
        <div className="min-w-0 flex-1">
          {account.open ? (
            <Link href={`/tailing/${account.id}`} className="block truncate font-semibold hover:underline">
              {account.name}
            </Link>
          ) : (
            <span className="block truncate font-semibold">{account.name}</span>
          )}
          <span className="block text-[11px] text-muted">
            {account.open ? `${s.bets} bet${s.bets === 1 ? "" : "s"} · ${account.upcoming} upcoming` : "Has turned tailing off"}
          </span>
        </div>
        <TailButton accountId={account.id} tailed={account.tailed} onChange={onChange} />
      </div>
      {account.open && (
        <div className="flex items-end justify-between gap-2">
          <ProfitAmount units={s.profit} />
          <span className="text-xs text-muted">
            ROI <span className={`tabular font-semibold ${s.roi === null ? "" : s.roi >= 0 ? "text-over" : "text-under"}`}>{pct(s.roi)}</span>
            {s.winRate !== null && <> · {s.winRate}% wins</>}
          </span>
        </div>
      )}
      {account.open && (
        <Link href={`/tailing/${account.id}`} className="btn-ghost py-1 text-xs">
          View profit &amp; bets
        </Link>
      )}
    </div>
  );
}
