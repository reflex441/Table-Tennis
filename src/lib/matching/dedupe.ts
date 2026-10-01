/**
 * Player-name normalisation, duplicate keys and merge suggestions.
 * Pure functions shared by the server (duplicate prevention) and the review
 * UI (suggesting that two screenshots describe the same match).
 */

export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Order-insensitive key for a pair of players. */
export function playersKey(player1: string, player2: string): string {
  return [normalizeName(player1), normalizeName(player2)].sort().join("|");
}

/** Unique key for a match: same players (any order) at the same minute. */
export function matchDedupeKey(player1: string, player2: string, startsAt: Date): string {
  const minute = new Date(Math.floor(startsAt.getTime() / 60_000) * 60_000).toISOString();
  return `${playersKey(player1, player2)}@${minute}`;
}

export type NameSimilarity = "same" | "similar" | "different";

/**
 * Compare two player names. "Varcl J" vs "Varcl J." is "same";
 * "Varcl J" vs "Jiri Varcl" is "similar" (shared surname token).
 */
export function compareNames(a: string | null, b: string | null): NameSimilarity {
  if (!a || !b) return "different";
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return "different";
  if (na === nb) return "same";
  const ta = na.split(" ").filter((t) => t.length >= 3);
  const tb = new Set(nb.split(" ").filter((t) => t.length >= 3));
  return ta.some((t) => tb.has(t)) ? "similar" : "different";
}

export interface PlayerPair {
  player1: string | null;
  player2: string | null;
}

/** Compare two matches by players, in either order. */
export function comparePlayers(a: PlayerPair, b: PlayerPair): NameSimilarity {
  const rank = (s: NameSimilarity) => (s === "same" ? 2 : s === "similar" ? 1 : 0);
  const direct = Math.min(rank(compareNames(a.player1, b.player1)), rank(compareNames(a.player2, b.player2)));
  const swapped = Math.min(rank(compareNames(a.player1, b.player2)), rank(compareNames(a.player2, b.player1)));
  const best = Math.max(direct, swapped);
  return best === 2 ? "same" : best === 1 ? "similar" : "different";
}

export interface MergeSuggestion {
  /** Candidate ids that appear to describe the same match. */
  ids: [string, string];
  similarity: "same" | "similar";
  reason: string;
}

export interface CandidateLike extends PlayerPair {
  id: string;
  sourceId: string;
  startsAt?: string | null;
}

/**
 * Suggest pairs of candidates from *different* screenshots that look like the
 * same match. Suggestions are never applied automatically.
 */
export function suggestMerges(candidates: CandidateLike[], toleranceMinutes = 10): MergeSuggestion[] {
  const out: MergeSuggestion[] = [];
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i];
      const b = candidates[j];
      if (a.sourceId === b.sourceId) continue;
      const sim = comparePlayers(a, b);
      if (sim === "different") continue;
      if (a.startsAt && b.startsAt) {
        const diff = Math.abs(new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
        if (diff > toleranceMinutes * 60_000) continue;
      }
      out.push({
        ids: [a.id, b.id],
        similarity: sim,
        reason: sim === "same" ? "Same players found in two screenshots." : "Similar player names found in two screenshots.",
      });
    }
  }
  return out;
}

export interface MergeConflict<K extends string = string> {
  field: K;
  primary: unknown;
  secondary: unknown;
}

/**
 * Merge two partial records. Missing (null) fields on the primary are filled
 * from the secondary; when both have different values the primary wins and a
 * conflict is reported so the user can pick.
 */
export function mergeRecords<T extends Record<string, unknown>>(primary: T, secondary: T, fields: (keyof T & string)[]): { merged: T; conflicts: MergeConflict<keyof T & string>[] } {
  const merged = { ...primary };
  const conflicts: MergeConflict<keyof T & string>[] = [];
  for (const field of fields) {
    const p = primary[field];
    const s = secondary[field];
    if (p === null || p === undefined || p === "") {
      if (s !== null && s !== undefined && s !== "") merged[field] = s;
    } else if (s !== null && s !== undefined && s !== "" && !valuesEqual(p, s)) {
      conflicts.push({ field, primary: p, secondary: s });
    }
  }
  return { merged, conflicts };
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (typeof a === "string" && typeof b === "string") return normalizeName(a) === normalizeName(b);
  return a === b;
}
