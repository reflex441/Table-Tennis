import type { PrismaClient } from "@/generated/prisma/client";
import type { BetResult, BetRow, PlayType } from "./profit";
import type { Selection } from "@/lib/selection";

export interface BetRowWithMatch extends BetRow {
  player1: string;
  player2: string;
  startsAt: string;
  selection: Selection | null;
  pointsLine: number | null;
}

/** Every recorded bet with the match details needed for the profit page. */
export async function listBetRows(prisma: PrismaClient, userId: string, opts: { since?: Date; playType?: PlayType } = {}): Promise<BetRowWithMatch[]> {
  const rows = await prisma.bet.findMany({
    where: {
      match: {
        userId,
        ...(opts.since ? { startsAt: { gte: opts.since } } : {}),
        ...(opts.playType ? { playType: opts.playType } : {}),
      },
    },
    include: { match: { include: { statistics: true } } },
    orderBy: { match: { startsAt: "desc" } },
    take: 5000,
  });
  return rows.map((b) => ({
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
  }));
}
