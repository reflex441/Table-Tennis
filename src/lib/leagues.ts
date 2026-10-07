/** Bookmaker links per league (Settings → League links). Client-safe helpers. */

export interface LeagueLink {
  league: string;
  url: string;
}

/** Leagues offered by default in Settings. */
export const SUGGESTED_LEAGUES = ["TT CUP", "TT ELITE", "CZECH LIGA PRO"];

/**
 * The only competitions bets are on (the League picker on the Profit page).
 * Always stored in capitals so "TT Cup" and "TT CUP" count as one league.
 */
export const COMPETITIONS = ["TT ELITE", "TT CUP", "CZECH LIGA PRO"] as const;
export type Competition = (typeof COMPETITIONS)[number];

/** "TT Elite Series - Men", "TT Cup", "Liga Pro" -> one of COMPETITIONS, else null. */
export function canonicalCompetition(name: string | null | undefined): Competition | null {
  const key = normalizeLeague(name);
  if (!key) return null;
  if (key.includes("elite")) return "TT ELITE";
  if (key.includes("czech") || key.includes("ligapro")) return "CZECH LIGA PRO";
  if (key.includes("ttcup") || key === "cup") return "TT CUP";
  return null;
}

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

export type Bookmaker = "ladbrokes" | "sportsbet";

/** League pages per bookmaker, used to fill in League links in one click. */
export const BOOKMAKER_LINKS: Record<Bookmaker, LeagueLink[]> = {
  ladbrokes: [
    { league: "TT CUP", url: "https://www.ladbrokes.com.au/sports/table-tennis/tt-cup" },
    { league: "TT ELITE", url: "https://www.ladbrokes.com.au/sports/table-tennis/tt-elite-series" },
    { league: "CZECH LIGA PRO", url: "https://www.ladbrokes.com.au/sports/table-tennis/czech-liga-pro" },
  ],
  // Sportsbet doesn't offer Czech Liga Pro.
  sportsbet: [
    { league: "TT CUP", url: "https://www.sportsbet.com.au/betting/table-tennis/tt-cup" },
    { league: "TT ELITE", url: "https://www.sportsbet.com.au/betting/table-tennis/tt-elite-series-men" },
  ],
};

/** Sets the bookmaker's league pages, keeping links for any other leagues. */
export function withBookmakerLinks(current: LeagueLink[], bookmaker: Bookmaker): LeagueLink[] {
  const links = BOOKMAKER_LINKS[bookmaker];
  const replaced = new Set(links.map((l) => normalizeLeague(l.league)));
  return [...links, ...current.filter((l) => !replaced.has(normalizeLeague(l.league)))];
}

/**
 * When each bookmaker publishes its Over/Under points lines, in minutes
 * before the match: the suggested alarm time for that bookmaker.
 */
export const BOOKMAKER_LINES_MINUTES: Record<Bookmaker, number> = { ladbrokes: 5, sportsbet: 30 };

/** Known leagues in capitals ("TT Cup" -> "TT CUP"); anything else as typed. */
export function tidyCompetition(name: string | null): string | null {
  return name ? (canonicalCompetition(name) ?? name) : name;
}
