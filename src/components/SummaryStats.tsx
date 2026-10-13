import { formatUnits, type ProfitSummary } from "@/lib/bets/profit";

/** "+12.5%", "-3%", or "–" when there's nothing to show. */
export function pct(n: number | null): string {
  return n === null ? "–" : `${n > 0 ? "+" : ""}${n}%`;
}

/** ROI, win rate, record and units staked: the figures on the profit summary cards. */
export function SummaryStats({ summary }: { summary: ProfitSummary }) {
  return (
    <dl className="mt-2 grid grid-cols-4 gap-2 text-xs">
      <div>
        <dt className="text-muted">ROI</dt>
        <dd className={`tabular font-semibold ${summary.roi === null ? "" : summary.roi >= 0 ? "text-over" : "text-under"}`}>{pct(summary.roi)}</dd>
      </div>
      <div>
        <dt className="text-muted">Win rate</dt>
        <dd className="tabular font-semibold">{summary.winRate === null ? "–" : `${summary.winRate}%`}</dd>
      </div>
      <div>
        <dt className="text-muted">Record</dt>
        <dd className="tabular font-semibold">
          {summary.won}-{summary.lost}
          {summary.void ? `-${summary.void}` : ""}
        </dd>
      </div>
      <div>
        <dt className="text-muted">Staked</dt>
        <dd className="tabular font-semibold">{formatUnits(summary.staked, false)}</dd>
      </div>
    </dl>
  );
}
