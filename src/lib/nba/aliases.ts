/**
 * NBA picks: who a pick belongs to and which bookmaker it's on, from what the
 * screenshot shows. Both lists are editable in Settings → NBA. Client-safe.
 */

export interface TipsterAlias {
  /** Text in the sender's name, e.g. "Winible" (case doesn't matter). */
  match: string;
  /** Tipster it belongs to, e.g. "ADP". */
  name: string;
}

export interface BookmakerAlias {
  /** Code or name as written in picks, e.g. "FD". */
  code: string;
  /** Bookmaker it means, e.g. "Sportsbet". */
  name: string;
}

export const DEFAULT_TIPSTERS: TipsterAlias[] = [{ match: "Winible", name: "ADP" }];

/** The bookmakers to pick from, each always spelt this one way. */
export const NBA_BOOKMAKERS = ["Bet365", "Ladbrokes", "Tab", "Sportsbet", "Pointsbet"] as const;

export const DEFAULT_BOOKMAKERS: BookmakerAlias[] = [
  { code: "FD", name: "Sportsbet" },
  { code: "FanDuel", name: "Sportsbet" },
  { code: "SB", name: "Sportsbet" },
  { code: "LB", name: "Ladbrokes" },
  { code: "PB", name: "Pointsbet" },
  { code: "DK", name: "DraftKings" },
  { code: "CZR", name: "Caesars" },
  { code: "MGM", name: "BetMGM" },
  { code: "NV", name: "Novig" },
  { code: "B365", name: "Bet365" },
];

const key = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** Read a stored list defensively; null (never edited) means the built-in list. */
export function parseTipsters(value: unknown): TipsterAlias[] {
  if (!Array.isArray(value)) return DEFAULT_TIPSTERS;
  return value
    .filter((v): v is TipsterAlias => Boolean(v) && typeof v.match === "string" && typeof v.name === "string")
    .map((v) => ({ match: v.match, name: v.name }));
}

export function parseBookmakers(value: unknown): BookmakerAlias[] {
  if (!Array.isArray(value)) return DEFAULT_BOOKMAKERS;
  return value
    .filter((v): v is BookmakerAlias => Boolean(v) && typeof v.code === "string" && typeof v.name === "string")
    .map((v) => ({ code: v.code, name: v.name }));
}

/**
 * Whose pick: the first alias found in the sender's name ("Winible Bot" ->
 * "ADP"), else the sender's name itself ("Tyvan").
 */
export function tipsterFor(sender: string | null | undefined, aliases: TipsterAlias[]): string | null {
  const s = key(sender);
  if (!s) return null;
  const hit = aliases.find((a) => key(a.match) && s.includes(key(a.match)));
  if (hit) return hit.name.trim();
  return (
    (sender ?? "")
      .replace(/[^\p{L}\p{N}\s'._-]/gu, "")
      .replace(/\b(bot|app)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim() || null
  );
}

/**
 * One spelling per bookmaker, so it's counted once: "PointsBet", "points bet"
 * -> "Pointsbet", "TAB" -> "Tab", "bet 365" -> "Bet365". Others stay as written.
 */
export function canonicalBookmaker(name: string | null | undefined): string | null {
  const raw = (name ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  return NBA_BOOKMAKERS.find((b) => key(b) === key(raw)) ?? raw;
}

/**
 * The bookmaker: a code ("FD" -> "Sportsbet"), a bookmaker's own name, or
 * the text as written. "+138 FD +137 NV" is on the first one listed (FD).
 */
export function bookmakerFor(text: string | null | undefined, aliases: BookmakerAlias[]): string | null {
  const raw = (text ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  const whole = key(raw);
  const known = [...aliases, ...NBA_BOOKMAKERS.map((b) => ({ code: b, name: b }))];
  const exact = known.find((a) => key(a.code) === whole || key(a.name) === whole);
  if (exact) return canonicalBookmaker(exact.name);
  // First code or name that appears as a word, in the order written.
  const words = raw.split(/[^A-Za-z0-9]+/).filter(Boolean);
  for (const w of words) {
    const hit = known.find((a) => key(a.code) === key(w) || key(a.name) === key(w));
    if (hit) return canonicalBookmaker(hit.name);
  }
  return canonicalBookmaker(raw.replace(/^(all\s+)?on\s+/i, "").slice(0, 40));
}

/** Tipster names for suggestions: the aliases' names plus any already used. */
export function knownTipsters(aliases: TipsterAlias[], used: string[]): string[] {
  return [...new Set([...aliases.map((a) => a.name.trim()), ...used].filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
