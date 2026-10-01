import type { PrismaClient } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { round2 } from "@/lib/bets/profit";

/** Accounts need this many settled bets to be ranked. */
export const LEADERBOARD_MIN_BETS = 100;

export interface LeaderboardRow {
  userId: string;
  name: string;
  /** Settled bets with a known profit (won / lost / void). */
  bets: number;
  won: number;
  lost: number;
  winRate: number | null;
  staked: number;
  /** Units. */
  profit: number;
  /** Profit / staked × 100. */
  roi: number | null;
}

export interface Leaderboard {
  minBets: number;
  byProfit: (LeaderboardRow & { rank: number })[];
  byRoi: (LeaderboardRow & { rank: number })[];
  /** The signed-in user's own numbers, ranked or not. */
  me: (LeaderboardRow & { rankProfit: number | null; rankRoi: number | null; hidden: boolean }) | null;
}

type RawRow = { userId: string; name: string; bets: number; won: number; lost: number; staked: number | null; profit: number | null; visible: boolean };

function toRow(r: RawRow): LeaderboardRow {
  const staked = round2(Number(r.staked ?? 0));
  const profit = round2(Number(r.profit ?? 0));
  const decided = r.won + r.lost;
  return {
    userId: r.userId,
    name: r.name,
    bets: r.bets,
    won: r.won,
    lost: r.lost,
    winRate: decided ? round2((r.won / decided) * 100) : null,
    staked,
    profit,
    roi: staked ? round2((profit / staked) * 100) : null,
  };
}

/**
 * Rank accounts by units profited and by ROI. Only settled bets count, only
 * accounts with at least `minBets` of them are ranked, and accounts that
 * turned off "Show me on the leaderboard" are left out.
 */
export async function getLeaderboard(
  prisma: PrismaClient,
  opts: { currentUserId: string; playType?: "BOT" | "PERSONAL"; minBets?: number; limit?: number },
): Promise<Leaderboard> {
  const minBets = opts.minBets ?? LEADERBOARD_MIN_BETS;
  const typeFilter = opts.playType ? Prisma.sql`AND m."playType" = ${opts.playType}::"PlayType"` : Prisma.empty;
  const raw = await prisma.$queryRaw<RawRow[]>(Prisma.sql`
    SELECT u."id" AS "userId",
           u."name" AS "name",
           COUNT(*)::int AS "bets",
           COUNT(*) FILTER (WHERE b."result" = 'WON')::int AS "won",
           COUNT(*) FILTER (WHERE b."result" = 'LOST')::int AS "lost",
           SUM(CASE WHEN b."result" <> 'VOID' THEN b."stake" ELSE 0 END)::float8 AS "staked",
           SUM(b."profit")::float8 AS "profit",
           COALESCE(BOOL_AND(s."showOnLeaderboard"), true) AS "visible"
      FROM "Bet" b
      JOIN "Match" m ON m."id" = b."matchId"
      JOIN "User" u ON u."id" = m."userId"
      LEFT JOIN "Settings" s ON s."userId" = u."id"
     WHERE b."result" <> 'PENDING' AND b."profit" IS NOT NULL ${typeFilter}
     GROUP BY u."id", u."name"`);

  const rows = raw.map((r) => ({ ...toRow(r), visible: r.visible }));
  const ranked = rows.filter((r) => r.visible && r.bets >= minBets);
  const limit = opts.limit ?? 50;
  const strip = ({ visible, ...r }: (typeof rows)[number]) => (void visible, r);

  const byProfit = [...ranked].sort((a, b) => b.profit - a.profit || b.bets - a.bets).map((r, i) => ({ ...strip(r), rank: i + 1 }));
  const byRoi = [...ranked]
    .filter((r) => r.roi !== null)
    .sort((a, b) => b.roi! - a.roi! || b.bets - a.bets)
    .map((r, i) => ({ ...strip(r), rank: i + 1 }));

  const mine = rows.find((r) => r.userId === opts.currentUserId);
  const me = mine
    ? {
        ...strip(mine),
        hidden: !mine.visible,
        rankProfit: byProfit.find((r) => r.userId === mine.userId)?.rank ?? null,
        rankRoi: byRoi.find((r) => r.userId === mine.userId)?.rank ?? null,
      }
    : null;
  return { minBets, byProfit: byProfit.slice(0, limit), byRoi: byRoi.slice(0, limit), me };
}
