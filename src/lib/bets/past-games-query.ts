import type { PrismaClient } from "@/generated/prisma/client";
import { normalizeName, playersKey } from "@/lib/matching/dedupe";
import { canonicalCompetition, type Competition } from "@/lib/leagues";
import { isSelection } from "@/lib/selection";
import { getTailedAccount } from "@/lib/tailing";
import { sameGame, type KnownPlayer, type PastGame, type PastSuggestions } from "./past-games";

const GAME_DAYS = 30;
const MAX_GAMES = 300;
const MAX_HISTORY = 5000;

/**
 * What "Add past bet" suggests: the players of your matches and the owner's
 * (the account everyone tails, whose games the Tailing page shows anyway),
 * with the leagues they played in, and the games of the last 30 days that have
 * already started. Your own match wins over the owner's copy of the same game.
 */
export async function pastBetSuggestions(prisma: PrismaClient, userId: string, now = new Date()): Promise<PastSuggestions> {
  const owner = await getTailedAccount(prisma);
  const userIds = [...new Set([userId, ...(owner ? [owner.id] : [])])];
  const [history, recent] = await Promise.all([
    prisma.match.findMany({
      where: { userId: { in: userIds } },
      select: { player1: true, player2: true, competition: true, startsAt: true },
      orderBy: { startsAt: "desc" },
      take: MAX_HISTORY,
    }),
    prisma.match.findMany({
      where: { userId: { in: userIds }, startsAt: { lte: now, gte: new Date(now.getTime() - GAME_DAYS * 86_400_000) } },
      select: {
        userId: true,
        player1: true,
        player2: true,
        competition: true,
        startsAt: true,
        playType: true,
        statistics: { select: { selection: true, pointsLine: true } },
        bet: { select: { autoFilled: true } },
      },
      orderBy: { startsAt: "desc" },
      take: MAX_GAMES * 2,
    }),
  ]);

  // Players: the latest spelling of each name, with its games per league.
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

  const games: PastGame[] = [];
  // Games by their two players, to find the same game quickly.
  const byPlayers = new Map<string, number[]>();
  for (const m of recent) {
    const game: PastGame = {
      player1: m.player1,
      player2: m.player2,
      competition: canonicalCompetition(m.competition) ?? m.competition,
      startsAt: m.startsAt.toISOString(),
      playType: m.playType === "BOT" ? "BOT" : "PERSONAL",
      selection: isSelection(m.statistics?.selection) ? m.statistics.selection : null,
      pointsLine: m.statistics?.pointsLine ?? null,
      mine: m.userId === userId,
      bet: m.userId === userId && Boolean(m.bet && !m.bet.autoFilled),
    };
    const key = playersKey(game.player1, game.player2);
    const same = byPlayers.get(key) ?? [];
    const i = same.find((j) => sameGame(games[j], game));
    if (i === undefined) {
      byPlayers.set(key, [...same, games.push(game) - 1]);
    } else if (game.mine && !games[i].mine) games[i] = game;
    if (games.length >= MAX_GAMES) break;
  }
  return { players, games };
}
