/** Bookmaker links per league (Settings → League links). Client-safe helpers. */

export interface LeagueLink {
  league: string;
  url: string;
}

/** Leagues offered by default in Settings. */
export const SUGGESTED_LEAGUES = ["TT Cup", "TT Elite", "Czech Liga Pro"];

/** "TT CUP", "tt-cup" and "TT Cup " all become "ttcup". */
export function normalizeLeague(name: string | null | undefined): string {
  return (name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Only plain web links can be opened (never javascript: or data: URLs). */
export function isSafeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * The bookmaker link for a match's competition: an exact (normalized) league
 * match first, else a league whose name is contained in the competition
 * (e.g. "Czech Liga Pro" for "Czech Liga Pro - Men").
 */
export function findLeagueUrl(competition: string | null | undefined, links: LeagueLink[]): string | null {
  const key = normalizeLeague(competition);
  if (!key) return null;
  const usable = links.filter((l) => normalizeLeague(l.league) && isSafeUrl(l.url));
  const exact = usable.find((l) => normalizeLeague(l.league) === key);
  if (exact) return exact.url;
  const partial = usable
    .filter((l) => key.includes(normalizeLeague(l.league)))
    .sort((a, b) => normalizeLeague(b.league).length - normalizeLeague(a.league).length)[0];
  return partial?.url ?? null;
}

/** Read the stored JSON defensively. */
export function parseLeagueLinks(value: unknown): LeagueLink[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is LeagueLink => Boolean(v) && typeof v.league === "string" && typeof v.url === "string")
    .map((v) => ({ league: v.league, url: v.url }));
}
