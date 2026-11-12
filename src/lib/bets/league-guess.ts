import type { PrismaClient } from "@/generated/prisma/client";
import { getTailedAccount } from "@/lib/tailing";
import { buildLeagueIndex, type LeagueIndex } from "./league-index";

export { buildLeagueIndex, guessCompetition } from "./league-index";

/** The matches of these accounts (most recent first). */
async function loadLeagueIndex(prisma: PrismaClient, userIds: string[]): Promise<LeagueIndex> {
  const rows = await prisma.match.findMany({
    where: { userId: { in: [...new Set(userIds)] }, competition: { not: null } },
    select: { player1: true, player2: true, competition: true, startsAt: true },
    orderBy: { startsAt: "desc" },
    take: 5000,
  });
  return buildLeagueIndex(rows);
}

/**
 * What bet slip scans guess from: only the owner's matches (the account
 * everyone tails), for every account - not the scanning person's own.
 */
export async function ownerLeagueIndex(prisma: PrismaClient): Promise<LeagueIndex> {
  const owner = await getTailedAccount(prisma);
  return owner ? loadLeagueIndex(prisma, [owner.id]) : buildLeagueIndex([]);
}
