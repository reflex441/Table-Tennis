import type { PrismaClient } from "@/generated/prisma/client";
import { normalizeName } from "@/lib/matching/dedupe";
import { canonicalCompetition, type Competition } from "@/lib/leagues";
import { getTailedAccount } from "@/lib/tailing";
import type { KnownPlayer, PastSuggestions } from "./past-games";

const MAX_HISTORY = 5000;

/**
 * What "Add past bet" suggests as you type a player: the players of your
 * matches and the owner's (the account everyone tails, whose games the
 * Tailing page shows anyway), with the leagues they played in. The latest
 * spelling of each name is the one shown.
 */
export async function pastBetSuggestions(prisma: PrismaClient, userId: string): Promise<PastSuggestions> {
  const owner = await getTailedAccount(prisma);
  const history = await prisma.match.findMany({
    where: { userId: { in: [...new Set([userId, ...(owner ? [owner.id] : [])])] } },
    select: { player1: true, player2: true, competition: true, startsAt: true },
    orderBy: { startsAt: "desc" },
    take: MAX_HISTORY,
  });
  const byName = new Map<string, { name: string; games: number; leagues: Map<Competition, [number, number]> }>();
  for (const m of history) {
    const league = canonicalCompetition(m.competition);
    const at = m.startsAt.getTime();
    for (const name of [m.player1, m.player2]) {
      const key = normalizeName(name);
      if (!key) continue;
      const p = byName.get(key) ?? { name, games: 0, leagues: new Map() };
      p.games++;
      if (league) {
        const [n, last] = p.leagues.get(league) ?? [0, 0];
        p.leagues.set(league, [n + 1, Math.max(last, at)]);
      }
      byName.set(key, p);
    }
  }
  const players: KnownPlayer[] = [...byName.values()]
    .sort((a, b) => b.games - a.games)
    .map((p) => ({ name: p.name, games: p.games, leagues: [...p.leagues].map(([league, [n, last]]) => [league, n, last]) }));
  return { players };
}
