import { normalizeName } from "@/lib/matching/dedupe";
import type { Competition } from "@/lib/leagues";
import { nameTokens, type LeagueIndex, type Tally } from "./league-index";

/**
 * "Add past bet": as you type a player, the names of players from past
 * matches (yours and the account everyone tails) come up to click. The form
 * loads them once when it opens (see pastBetSuggestions) and searches them in
 * the browser, so typing costs the server nothing. Client-safe.
 */

/** A player from past matches, with the leagues they played in: [league, games, last game (ms)]. */
export interface KnownPlayer {
  name: string;
  games: number;
  leagues: [Competition, number, number][];
}

export interface PastSuggestions {
  players: KnownPlayer[];
}

/**
 * The name fits what's typed. Typed words of 2+ letters start a surname
 * ("jab" -> "Jablonski K."); a single letter next to them is the initial
 * ("Jablonski K.", "k jab"), so "Jablonski K." doesn't bring up "Komorowicz
 * J.". A full first name fits the initial when the surname fits too
 * ("Kacper Jablonski").
 */
export function nameFits(name: string, typed: string): boolean {
  const words = normalizeName(typed).split(" ").filter(Boolean);
  if (!words.length) return false;
  const parts = normalizeName(name).split(" ").filter(Boolean);
  const initials = parts.filter((p) => p.length === 1);
  const surnames = parts.filter((p) => p.length > 1);
  const startsSurname = (w: string) => surnames.some((s) => s.startsWith(w));
  const surnameFits = words.some((w) => w.length > 1 && startsSurname(w));
  return words.every((w) => {
    // One letter on its own: any name starting with it.
    if (w.length === 1) return words.length === 1 ? parts.some((p) => p.startsWith(w)) : initials.length ? initials.includes(w) : startsSurname(w);
    return startsSurname(w) || (surnameFits && initials.some((i) => w.startsWith(i)));
  });
}

/** Players that fit: the exact name first, then surnames starting with what's typed, then those with the most games. */
export function searchPlayers(players: KnownPlayer[], typed: string, limit = 6): KnownPlayer[] {
  const exact = normalizeName(typed);
  const first = exact.split(" ")[0] ?? "";
  const rank = (p: KnownPlayer) => {
    const name = normalizeName(p.name);
    return name === exact ? 0 : name.startsWith(first) ? 1 : 2;
  };
  return players
    .filter((p) => nameFits(p.name, typed))
    .sort((a, b) => rank(a) - rank(b) || b.games - a.games)
    .slice(0, limit);
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
