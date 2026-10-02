/**
 * Profit calculations for placed bets. Stakes and profit are in UNITS;
 * money = units × the unit size from Settings. Pure functions shared by
 * server and UI.
 */

export type BetResult = "PENDING" | "WON" | "LOST" | "VOID";
export type PlayType = "BOT" | "PERSONAL";

/**
 * Profit of a bet with decimal odds:
 *  - WON: stake × (odds − 1)  (unknown until the odds are entered)
 *  - LOST: −stake
 *  - VOID: 0
 *  - PENDING: not settled yet
 */
export function computeProfit(stake: number, odds: number | null | undefined, result: BetResult): number | null {
  switch (result) {
    case "WON":
      return odds && odds > 1 ? round2(stake * (odds - 1)) : null;
    case "LOST":
      return round2(-stake);
    case "VOID":
      return 0;
    default:
      return null;
  }
}

export interface LegLike {
  stake: number;
  odds: number | null;
  result: BetResult;
}

/**
 * Totals of a split bet: stake and profit are the sums of its picks. It is
 * pending until every pick is settled; then WON / LOST by the net profit
 * (0 = VOID). A won pick without odds leaves the profit unknown (WON, null).
 */
export function combineLegs(legs: LegLike[]): { stake: number; result: BetResult; profit: number | null } {
  const stake = round2(legs.reduce((sum, l) => sum + l.stake, 0));
  if (legs.some((l) => l.result === "PENDING")) return { stake, result: "PENDING", profit: null };
  const profits = legs.map((l) => computeProfit(l.stake, l.odds, l.result));
  if (profits.some((p) => p === null)) return { stake, result: "WON", profit: null };
  const net = round2(profits.reduce<number>((sum, p) => sum + (p ?? 0), 0));
  return { stake, result: net > 0 ? "WON" : net < 0 ? "LOST" : "VOID", profit: net };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface BetRow {
  id: string;
  matchId: string;
  playType: PlayType;
  competition: string | null;
  stake: number;
  odds: number | null;
  result: BetResult;
  profit: number | null;
  placedAt: string;
}

export interface ProfitSummary {
  bets: number;
  pending: number;
  /** WON + LOST + VOID with a known profit. */
  settled: number;
  won: number;
  lost: number;
  void: number;
  /** Wins as % of decided bets (won + lost). */
  winRate: number | null;
  /** Total stake of settled bets. */
  staked: number;
  profit: number;
  /** Profit / staked × 100. */
  roi: number | null;
  avgOdds: number | null;
  /** Won bets still missing odds (profit unknown). */
  missingOdds: number;
}

export function summarize(rows: BetRow[]): ProfitSummary {
  let pending = 0, won = 0, lost = 0, voided = 0, staked = 0, profit = 0, missingOdds = 0, oddsSum = 0, oddsCount = 0;
  for (const r of rows) {
    if (r.odds) {
      oddsSum += r.odds;
      oddsCount++;
    }
    if (r.result === "PENDING") {
      pending++;
      continue;
    }
    if (r.result === "WON" && r.profit === null) {
      missingOdds++;
      continue;
    }
    if (r.result === "WON") won++;
    else if (r.result === "LOST") lost++;
    else voided++;
    if (r.result !== "VOID") staked += r.stake;
    profit += r.profit ?? 0;
  }
  const decided = won + lost;
  return {
    bets: rows.length,
    pending,
    settled: won + lost + voided,
    won,
    lost,
    void: voided,
    winRate: decided ? round2((won / decided) * 100) : null,
    staked: round2(staked),
    profit: round2(profit),
    roi: staked ? round2((profit / staked) * 100) : null,
    avgOdds: oddsCount ? round2(oddsSum / oddsCount) : null,
    missingOdds,
  };
}

/** Summaries per group (e.g. per competition), most profitable first. */
export function summarizeBy(rows: BetRow[], key: (r: BetRow) => string): { key: string; summary: ProfitSummary }[] {
  const groups = new Map<string, BetRow[]>();
  for (const r of rows) {
    const k = key(r);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.entries()]
    .map(([k, list]) => ({ key: k, summary: summarize(list) }))
    .sort((a, b) => b.summary.profit - a.summary.profit);
}

/** Default stake in units: what was set when the match was uploaded, else 1u. */
export function defaultStake(stakeUnits: number | null | undefined): number {
  return stakeUnits && stakeUnits > 0 ? stakeUnits : 1;
}

/** "+2.35u" style unit amount. */
export function formatUnits(n: number | null | undefined, signed = true): string {
  if (n === null || n === undefined) return "–";
  const v = round2(n);
  return `${signed && v > 0 ? "+" : ""}${v}u`;
}

/** "$23.50" style money amount for a number of units. */
export function formatMoney(units: number | null | undefined, unitSize: number, currency: string, signed = true): string {
  if (units === null || units === undefined) return "–";
  const v = round2(units * unitSize);
  const sign = v < 0 ? "-" : signed && v > 0 ? "+" : "";
  return `${sign}${currency}${Math.abs(v).toFixed(2)}`;
}
