import type { PrismaClient } from "@/generated/prisma/client";
import type { BetResult, BetRow, PlayType } from "./profit";
import type { Selection } from "@/lib/selection";
import { matchupCount } from "./matchups";

export interface BetRowWithMatch extends BetRow {
  player1: string;
  player2: string;
  startsAt: string;
  selection: Selection | null;
  pointsLine: number | null;
  /** Previous matchups of the two players (O/U record "11/3" -> 14), null if unknown. */
  matchups: number | null;
  /** Set on the rows of a split bet: this is pick `index + 1` of `of`. */
  split: { index: number; of: number } | null;
}

/**
 * Every recorded bet with the match details needed for the profit page.
 * A split bet becomes one row per pick (its own pick, stake, odds and
 * result), so per-pick stats count each part; the rows add up to the bet.
 */
export async function listBetRows(prisma: PrismaClient, userId: string, opts: { since?: Date; playType?: PlayType } = {}): Promise<BetRowWithMatch[]> {
  const rows = await prisma.bet.findMany({
    where: {
      match: {
        userId,
        ...(opts.since ? { startsAt: { gte: opts.since } } : {}),
      },
    },
    include: { match: { include: { statistics: true } }, legs: { orderBy: { position: "asc" } } },
    orderBy: { match: { startsAt: "desc" } },
    take: 5000,
  });
  const all = rows.flatMap((b): BetRowWithMatch[] => {
    const base: BetRowWithMatch = {
      id: b.id,
      matchId: b.matchId,
      playType: b.match.playType as PlayType,
      competition: b.match.competition,
      stake: b.stake,
      odds: b.odds,
      result: b.result as BetResult,
      profit: b.profit,
      placedAt: b.placedAt.toISOString(),
      player1: b.match.player1,
      player2: b.match.player2,
      startsAt: b.match.startsAt.toISOString(),
      selection: (b.match.statistics?.selection as Selection | null) ?? null,
      pointsLine: b.match.statistics?.pointsLine ?? null,
      matchups: matchupCount(b.match.statistics?.ouStats),
      split: null,
    };
    if (!b.legs.length) return [base];
    return b.legs.map((l, i) => ({
      ...base,
      id: `${b.id}:${i}`,
      stake: l.stake,
      odds: l.odds,
      result: l.result as BetResult,
      profit: l.profit,
      selection: l.selection as Selection,
      // A pick can be bot or personal on its own (e.g. a bot UNDER + a personal SWEEP).
      playType: (l.playType as PlayType | null) ?? base.playType,
      // The points line belongs to the match's own pick.
      pointsLine: l.selection === base.selection ? base.pointsLine : null,
      split: { index: i, of: b.legs.length },
    }));
  });
  // Filtered per row, as the picks of one split bet can differ.
  return opts.playType ? all.filter((r) => r.playType === opts.playType) : all;
}
