import type { PrismaClient } from "@/generated/prisma/client";
import { normalizeName } from "@/lib/matching/dedupe";
import { canonicalCompetition, type Competition } from "@/lib/leagues";

/**
 * Guessing a bet slip's competition from the players: a player who has
 * played in TT Cup before is most likely playing in TT Cup again. Names are
 * matched exactly ("Kovtanyuk D.") or by surname ("Dmytro Kovtanyuk").
 */

export interface LeagueHistoryRow {
  player1: string;
  player2: string;
  competition: string | null;
  startsAt: Date;
}

interface Tally {
  n: number;
  last: number;
}

export interface LeagueIndex {
  names: Map<string, Map<Competition, Tally>>;
  tokens: Map<string, Map<Competition, Tally>>;
}

/** Surname-like parts of a name ("kovtanyuk" from "Kovtanyuk D."). */
function nameTokens(normalized: string): string[] {
  return [...new Set(normalized.split(" ").filter((t) => t.length >= 3))];
}

function add(map: Map<string, Map<Competition, Tally>>, key: string, league: Competition, at: number) {
  const byLeague = map.get(key) ?? new Map<Competition, Tally>();
  const tally = byLeague.get(league) ?? { n: 0, last: 0 };
  byLeague.set(league, { n: tally.n + 1, last: Math.max(tally.last, at) });
  map.set(key, byLeague);
}

export function buildLeagueIndex(rows: LeagueHistoryRow[]): LeagueIndex {
  const index: LeagueIndex = { names: new Map(), tokens: new Map() };
  for (const row of rows) {
    const league = canonicalCompetition(row.competition);
    if (!league) continue;
    const at = row.startsAt.getTime();
    for (const player of [row.player1, row.player2]) {
      const name = normalizeName(player);
      if (!name) continue;
      add(index.names, name, league, at);
      for (const token of nameTokens(name)) add(index.tokens, token, league, at);
    }
  }
  return index;
}

/** The competition the players have played in most (an exact name counts 3x a surname). */
export function guessCompetition(player1: string | null, player2: string | null, index: LeagueIndex): Competition | null {
  const score = new Map<Competition, { points: number; last: number }>();
  const count = (byLeague: Map<Competition, Tally> | undefined, weight: number) => {
    for (const [league, tally] of byLeague ?? []) {
      const s = score.get(league) ?? { points: 0, last: 0 };
      score.set(league, { points: s.points + tally.n * weight, last: Math.max(s.last, tally.last) });
    }
  };
  for (const player of [player1, player2]) {
    const name = normalizeName(player ?? "");
    if (!name) continue;
    if (index.names.has(name)) {
      count(index.names.get(name), 3);
      continue;
    }
    for (const token of nameTokens(name)) count(index.tokens.get(token), 1);
  }
  const best = [...score.entries()].sort((a, b) => b[1].points - a[1].points || b[1].last - a[1].last)[0];
  return best?.[0] ?? null;
}

/** Your matches and the tailed account's (most recent first). */
export async function loadLeagueIndex(prisma: PrismaClient, userIds: string[]): Promise<LeagueIndex> {
  const rows = await prisma.match.findMany({
    where: { userId: { in: [...new Set(userIds)] }, competition: { not: null } },
    select: { player1: true, player2: true, competition: true, startsAt: true },
    orderBy: { startsAt: "desc" },
    take: 5000,
  });
  return buildLeagueIndex(rows);
}
