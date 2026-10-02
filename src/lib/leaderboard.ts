import type { PrismaClient } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { round2 } from "@/lib/bets/profit";
import { avatarUrl } from "@/lib/auth/accounts";
import { getTailedAccount } from "@/lib/tailing";

/** Accounts need this many settled bets to be ranked by ROI (the units ranking has no minimum). */
export const LEADERBOARD_MIN_BETS = 100;

export interface LeaderboardRow {
  userId: string;
  name: string;
  avatarUrl: string | null;
  /** This is the account everyone tails (link to the Tailing page). */
  tailable: boolean;
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

/** Emails always ranked by ROI, even below the minimum (LEADERBOARD_ALWAYS_SHOW, comma-separated). */
export function alwaysShownEmails(): Set<string> {
  return new Set(
    (process.env.LEADERBOARD_ALWAYS_SHOW ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

type RawRow = { userId: string; name: string; email: string; avatarUpdatedAt: Date | null; bets: number; won: number; lost: number; staked: number | null; profit: number | null; visible: boolean };

function toRow(r: RawRow): LeaderboardRow {
  const staked = round2(Number(r.staked ?? 0));
  const profit = round2(Number(r.profit ?? 0));
  const decided = r.won + r.lost;
  return {
    userId: r.userId,
    name: r.name,
    avatarUrl: avatarUrl({ id: r.userId, avatarUpdatedAt: r.avatarUpdatedAt }),
    tailable: false,
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
 * Rank accounts by units profited (no minimum) and by ROI (at least `minBets`
 * settled bets, except emails listed in LEADERBOARD_ALWAYS_SHOW). Only settled
 * bets count, and accounts that turned off "Show me on the leaderboard" are
 * left out.
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
           u."email" AS "email",
           u."avatarUpdatedAt" AS "avatarUpdatedAt",
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
     GROUP BY u."id", u."name", u."email", u."avatarUpdatedAt"`);

  const always = alwaysShownEmails();
  // Emails are only used here and never leave this function.
  const tailed = await getTailedAccount(prisma);
  const rows = raw.map((r) => ({ ...toRow(r), tailable: r.userId === tailed?.id, visible: r.visible, exempt: always.has(r.email.toLowerCase()) }));
  const visible = rows.filter((r) => r.visible);
  // Units: everyone with a settled bet. ROI: only with enough bets to mean something.
  const roiEligible = visible.filter((r) => r.bets >= minBets || r.exempt);
  const limit = opts.limit ?? 50;
  const strip = ({ visible, exempt, ...r }: (typeof rows)[number]) => (void visible, void exempt, r);

  const byProfit = [...visible].sort((a, b) => b.profit - a.profit || b.bets - a.bets).map((r, i) => ({ ...strip(r), rank: i + 1 }));
  const byRoi = [...roiEligible]
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
