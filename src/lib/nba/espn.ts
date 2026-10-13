import { DateTime } from "luxon";

/**
 * NBA scores and box scores from ESPN's public data (what ESPN's own website
 * and app load: free, no key, but unofficial - it can change without notice,
 * so everything here is read defensively and anything unexpected just means
 * "couldn't check", never a wrong result).
 */

export const ESPN_NBA_BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";

export interface EspnTeam {
  homeAway: "home" | "away" | null;
  score: number | null;
  winner: boolean | null;
  displayName: string; // "New York Knicks"
  name: string; // "Knicks"
  shortDisplayName: string; // "Knicks"
  abbreviation: string; // "NY"
  location: string; // "New York"
}

export interface EspnGame {
  id: string;
  startsAt: Date;
  name: string;
  /** "pre", "in" or "post". */
  state: string;
  completed: boolean;
  /** e.g. "STATUS_FINAL", "STATUS_POSTPONED". */
  statusName: string;
  teams: EspnTeam[];
}

export interface EspnPlayerLine {
  name: string;
  shortName: string;
  team: string;
  didNotPlay: boolean;
  /** null when the player has no stats (didn't play). */
  stats: { min: number; pts: number; reb: number; ast: number; threes: number; stl: number; blk: number; to: number } | null;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown): number | null => {
  const raw = v && typeof v === "object" && "value" in (v as object) ? (v as { value: unknown }).value : v;
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
};

export function parseScoreboard(json: unknown): EspnGame[] {
  const events = (json as { events?: unknown })?.events;
  if (!Array.isArray(events)) return [];
  return events.flatMap((e): EspnGame[] => {
    const ev = e as Record<string, unknown>;
    const comp = (Array.isArray(ev.competitions) ? ev.competitions[0] : null) as Record<string, unknown> | null;
    const status = (ev.status ?? comp?.status) as { type?: Record<string, unknown> } | undefined;
    const start = new Date(str(ev.date) || str(comp?.date));
    const competitors = Array.isArray(comp?.competitors) ? (comp!.competitors as Record<string, unknown>[]) : [];
    if (!str(ev.id) || Number.isNaN(start.getTime()) || competitors.length !== 2) return [];
    return [
      {
        id: str(ev.id),
        startsAt: start,
        name: str(ev.name) || str(ev.shortName),
        state: str(status?.type?.state),
        completed: status?.type?.completed === true,
        statusName: str(status?.type?.name),
        teams: competitors.map((c) => {
          const t = (c.team ?? {}) as Record<string, unknown>;
          return {
            homeAway: c.homeAway === "home" || c.homeAway === "away" ? c.homeAway : null,
            score: num(c.score),
            winner: typeof c.winner === "boolean" ? c.winner : null,
            displayName: str(t.displayName),
            name: str(t.name),
            shortDisplayName: str(t.shortDisplayName),
            abbreviation: str(t.abbreviation),
            location: str(t.location),
          };
        }),
      },
    ];
  });
}

/** Box score from a game summary: every player with their stats. */
export function parseBoxScore(json: unknown): EspnPlayerLine[] {
  const groups = (json as { boxscore?: { players?: unknown } })?.boxscore?.players;
  if (!Array.isArray(groups)) return [];
  const out: EspnPlayerLine[] = [];
  for (const g of groups as Record<string, unknown>[]) {
    const team = str((g.team as Record<string, unknown> | undefined)?.displayName);
    for (const s of (Array.isArray(g.statistics) ? g.statistics : []) as Record<string, unknown>[]) {
      const keys = (Array.isArray(s.keys) ? s.keys : []).map(str);
      const labels = (Array.isArray(s.labels) ? s.labels : Array.isArray(s.names) ? s.names : []).map((l: unknown) => str(l).toUpperCase());
      const at = (key: string, label: string) => {
        const i = keys.indexOf(key);
        return i >= 0 ? i : labels.indexOf(label);
      };
      const idx = {
        min: at("minutes", "MIN"),
        pts: at("points", "PTS"),
        reb: at("rebounds", "REB"),
        ast: at("assists", "AST"),
        threes: at("threePointFieldGoalsMade-threePointFieldGoalsAttempted", "3PT"),
        stl: at("steals", "STL"),
        blk: at("blocks", "BLK"),
        to: at("turnovers", "TO"),
      };
      for (const a of (Array.isArray(s.athletes) ? s.athletes : []) as Record<string, unknown>[]) {
        const athlete = (a.athlete ?? {}) as Record<string, unknown>;
        const name = str(athlete.displayName);
        if (!name) continue;
        const raw = Array.isArray(a.stats) ? (a.stats as unknown[]).map(str) : [];
        const get = (i: number) => {
          if (i < 0 || i >= raw.length) return null;
          const n = Number(raw[i].split("-")[0]);
          return Number.isFinite(n) ? n : null;
        };
        const values = { min: get(idx.min), pts: get(idx.pts), reb: get(idx.reb), ast: get(idx.ast), threes: get(idx.threes), stl: get(idx.stl), blk: get(idx.blk), to: get(idx.to) };
        const complete = raw.length > 0 && values.pts !== null && values.reb !== null && values.ast !== null && values.threes !== null;
        out.push({
          name,
          shortName: str(athlete.shortName),
          team,
          didNotPlay: a.didNotPlay === true || !complete,
          stats: complete
            ? { min: values.min ?? 0, pts: values.pts!, reb: values.reb!, ast: values.ast!, threes: values.threes!, stl: values.stl ?? 0, blk: values.blk ?? 0, to: values.to ?? 0 }
            : null,
        });
      }
    }
  }
  return out;
}

/** ESPN's scoreboard day (US Eastern) for a moment, e.g. "20261012". */
export function espnDay(d: Date): string {
  return DateTime.fromJSDate(d, { zone: "America/New_York" }).toFormat("yyyyMMdd");
}

export interface EspnClient {
  scoreboard(day: string): Promise<EspnGame[]>;
  boxScore(eventId: string): Promise<EspnPlayerLine[]>;
}

/**
 * Fetches with a short timeout, caching each day / game for the life of the
 * client (one grading pass), so a game is only downloaded once per pass.
 */
export function createEspnClient(opts: { baseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {}): EspnClient {
  const base = (opts.baseUrl ?? process.env.NBA_STATS_BASE_URL ?? ESPN_NBA_BASE).replace(/\/$/, "");
  const doFetch = opts.fetchImpl ?? fetch;
  const days = new Map<string, Promise<EspnGame[]>>();
  const boxes = new Map<string, Promise<EspnPlayerLine[]>>();
  const getJson = async (url: string) => {
    const res = await doFetch(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 8_000), headers: { accept: "application/json" }, cache: "no-store" });
    if (!res.ok) throw new Error(`ESPN returned ${res.status}`);
    return res.json();
  };
  return {
    scoreboard(day) {
      if (!days.has(day)) days.set(day, getJson(`${base}/scoreboard?dates=${day}`).then(parseScoreboard));
      return days.get(day)!;
    },
    boxScore(eventId) {
      if (!boxes.has(eventId)) boxes.set(eventId, getJson(`${base}/summary?event=${encodeURIComponent(eventId)}`).then(parseBoxScore));
      return boxes.get(eventId)!;
    },
  };
}
