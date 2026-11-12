import { normalizeName, playersKey } from "@/lib/matching/dedupe";
import type { Competition } from "@/lib/leagues";
import type { Selection } from "@/lib/selection";
import { nameTokens, type LeagueIndex, type Tally } from "./league-index";

/**
 * "Add past bet": as you type a player, past games and players you (and the
 * account everyone tails) have had come up to click. The form loads them once
 * when it opens (see pastBetSuggestions) and searches them in the browser, so
 * typing costs the server nothing. Client-safe.
 */

/** A player from past matches, with the leagues they played in: [league, games, last game (ms)]. */
export interface KnownPlayer {
  name: string;
  games: number;
  leagues: [Competition, number, number][];
}

/** A game that's already been played. */
export interface PastGame {
  player1: string;
  player2: string;
  competition: string | null;
  startsAt: string;
  playType: "BOT" | "PERSONAL";
  selection: Selection | null;
  pointsLine: number | null;
  /** On your dashboard (not only the owner's). */
  mine: boolean;
  /** You've recorded a bet on it already. */
  bet: boolean;
}

export interface PastSuggestions {
  players: KnownPlayer[];
  games: PastGame[];
}

/**
 * The name fits what's typed: every typed word starts a word of the name
 * ("lewc" -> "Lewczuk M.", "m lew" too), and a full first name fits an
 * initial ("Mateusz Lewczuk" -> "Lewczuk M.").
 */
export function nameFits(name: string, typed: string): boolean {
  const words = normalizeName(typed).split(" ").filter(Boolean);
  if (!words.length) return false;
  const parts = normalizeName(name).split(" ");
  return words.every((w) => parts.some((p) => p.startsWith(w) || (p.length === 1 && w.startsWith(p))));
}

/** Players that fit, surname matches first, then those with the most games. */
export function searchPlayers(players: KnownPlayer[], typed: string, limit = 5): KnownPlayer[] {
  const first = normalizeName(typed).split(" ")[0] ?? "";
  const surname = (p: KnownPlayer) => (normalizeName(p.name).startsWith(first) ? 0 : 1);
  return players
    .filter((p) => nameFits(p.name, typed))
    .sort((a, b) => surname(a) - surname(b) || b.games - a.games)
    .slice(0, limit);
}

/**
 * Past games with a player that fits, latest first. With the other player
 * filled in, games of those two come first.
 */
export function searchGames(games: PastGame[], typed: string, other = "", limit = 6): PastGame[] {
  const fits = games.filter((g) => nameFits(g.player1, typed) || nameFits(g.player2, typed));
  if (!normalizeName(other)) return fits.slice(0, limit);
  const both = (g: PastGame) => (nameFits(g.player1, other) || nameFits(g.player2, other) ? 0 : 1);
  return [...fits].sort((a, b) => both(a) - both(b)).slice(0, limit);
}

/** The league index (see guessCompetition) from the players' league tallies. */
export function leagueIndexOf(players: KnownPlayer[]): LeagueIndex {
  const index: LeagueIndex = { names: new Map(), tokens: new Map() };
  const bump = (map: LeagueIndex["names"], key: string, league: Competition, n: number, last: number) => {
    const byLeague = map.get(key) ?? new Map<Competition, Tally>();
    const t = byLeague.get(league) ?? { n: 0, last: 0 };
    byLeague.set(league, { n: t.n + n, last: Math.max(t.last, last) });
    map.set(key, byLeague);
  };
  for (const p of players) {
    const name = normalizeName(p.name);
    if (!name) continue;
    for (const [league, n, last] of p.leagues) {
      bump(index.names, name, league, n, last);
      for (const token of nameTokens(name)) bump(index.tokens, token, league, n, last);
    }
  }
  return index;
}

/** Same game: same two players (either order) within 5 minutes. */
export function sameGame(a: { player1: string; player2: string; startsAt: string }, b: { player1: string; player2: string; startsAt: string }): boolean {
  return playersKey(a.player1, a.player2) === playersKey(b.player1, b.player2) && Math.abs(Date.parse(a.startsAt) - Date.parse(b.startsAt)) <= 5 * 60_000;
}
