/**
 * What a unit was worth when. Bets are kept in units; the money amount next
 * to them is units x the unit size *at the time of the match*, so raising
 * your unit size ($200 -> $300) doesn't change what your old bets paid.
 * Changing the unit size remembers the old one for the bets before the
 * change. Client-safe.
 */

/** Bets on matches before `until` (and after the period before it) were worth `unitSize` a unit. */
export interface UnitSizePeriod {
  until: string;
  unitSize: number;
}

interface UnitSettings {
  unitSize: number;
  unitSizeHistory?: UnitSizePeriod[];
}

/** A change within this long of the last one is a correction (a typo fixed), not a new period. */
const CORRECTION_MS = 10 * 60_000;
const MAX_PERIODS = 20;

/** The stored history, valid entries only, oldest first. */
export function parseUnitSizeHistory(json: unknown): UnitSizePeriod[] {
  if (!Array.isArray(json)) return [];
  return json
    .flatMap((p): UnitSizePeriod[] => {
      if (!p || typeof p !== "object") return [];
      const { until, unitSize } = p as Record<string, unknown>;
      if (typeof until !== "string" || Number.isNaN(Date.parse(until)) || typeof unitSize !== "number" || !(unitSize > 0)) return [];
      return [{ until: new Date(until).toISOString(), unitSize }];
    })
    .sort((a, b) => Date.parse(a.until) - Date.parse(b.until))
    .slice(-MAX_PERIODS);
}

/** What a unit was worth for a match at `at`. */
export function unitSizeAt(s: UnitSettings, at: string | Date | null | undefined): number {
  const t = at instanceof Date ? at.getTime() : at ? Date.parse(at) : NaN;
  if (Number.isNaN(t)) return s.unitSize;
  for (const p of s.unitSizeHistory ?? []) if (t < Date.parse(p.until)) return p.unitSize;
  return s.unitSize;
}

/**
 * The history after the unit size changed from `from` to `to` at `now`:
 * bets before now keep `from` (when you have any). A change right after the
 * last one corrects it instead: changing back undoes it, a different value
 * replaces the one just set.
 */
export function historyAfterChange(history: UnitSizePeriod[], from: number, to: number, now: Date, hasEarlierBets: boolean): UnitSizePeriod[] {
  if (from === to) return history;
  const last = history[history.length - 1];
  if (last && now.getTime() - Date.parse(last.until) < CORRECTION_MS) {
    const before = history.slice(0, -1);
    return to === last.unitSize ? before : [...before, { until: now.toISOString(), unitSize: last.unitSize }];
  }
  if (!hasEarlierBets) return history;
  return [...history, { until: now.toISOString(), unitSize: from }].slice(-MAX_PERIODS);
}

/**
 * NBA: a tipster's own unit size (e.g. ADP $200, Tyvan $300). Their bets
 * from `since` on are worth `unitSize` a unit, with earlier changes kept in
 * `history` like yours; before `since` (and for tipsters not listed) it's
 * your unit size.
 */
export interface TipsterUnitSize {
  tipster: string;
  unitSize: number;
  since: string;
  history: UnitSizePeriod[];
}

/** `since` for "all their bets, earlier ones too". */
export const ALL_TIME = "1970-01-01T00:00:00.000Z";

const sameTipster = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function parseTipsterUnitSizes(json: unknown): TipsterUnitSize[] {
  if (!Array.isArray(json)) return [];
  const out: TipsterUnitSize[] = [];
  for (const t of json) {
    if (!t || typeof t !== "object") continue;
    const { tipster, unitSize, since, history } = t as Record<string, unknown>;
    if (typeof tipster !== "string" || !tipster.trim() || typeof unitSize !== "number" || !(unitSize > 0)) continue;
    if (out.some((o) => sameTipster(o.tipster, tipster))) continue;
    const from = typeof since === "string" && !Number.isNaN(Date.parse(since)) ? new Date(since).toISOString() : ALL_TIME;
    out.push({ tipster: tipster.trim(), unitSize, since: from, history: parseUnitSizeHistory(history) });
  }
  return out;
}

export function findTipsterUnitSize(list: TipsterUnitSize[] | undefined, tipster: string | null | undefined): TipsterUnitSize | null {
  return (tipster && list?.find((t) => sameTipster(t.tipster, tipster))) || null;
}

/** What a unit was worth for this tipster's bet at `at`. */
export function tipsterUnitSizeAt(s: UnitSettings & { nbaUnitSizes?: TipsterUnitSize[] }, tipster: string | null | undefined, at: string | Date | null | undefined): number {
  const own = findTipsterUnitSize(s.nbaUnitSizes, tipster);
  const t = at instanceof Date ? at.getTime() : at ? Date.parse(at) : NaN;
  if (!own || (!Number.isNaN(t) && t < Date.parse(own.since))) return unitSizeAt(s, at);
  return unitSizeAt({ unitSize: own.unitSize, unitSizeHistory: own.history }, at);
}

/** A tipster's unit size changed: their bets before now keep the old one (unless it was only just set). */
export function changeTipsterUnitSize(t: TipsterUnitSize, unitSize: number, now: Date): TipsterUnitSize {
  const justSet = !t.history.length && now.getTime() - Date.parse(t.since) < CORRECTION_MS;
  return { ...t, unitSize, history: justSet ? [] : historyAfterChange(t.history, t.unitSize, unitSize, now, true) };
}
