import { DateTime } from "luxon";
import { round2 } from "@/lib/bets/profit";

/** Markets an NBA pick can be. */
export const NBA_MARKETS = ["PLAYER_PROP", "MONEYLINE", "SPREAD", "TOTAL", "FUTURE", "PARLAY", "OTHER"] as const;
export type NbaMarket = (typeof NBA_MARKETS)[number];

export const NBA_MARKET_LABEL: Record<NbaMarket, string> = {
  PLAYER_PROP: "Player prop",
  MONEYLINE: "Moneyline",
  SPREAD: "Spread",
  TOTAL: "Total",
  FUTURE: "Future",
  PARLAY: "Parlay",
  OTHER: "Other",
};

export function isNbaMarket(v: unknown): v is NbaMarket {
  return typeof v === "string" && (NBA_MARKETS as readonly string[]).includes(v);
}

/**
 * Decimal odds from what a pick shows: "1.72", "$2.25", "1.72 odds", or
 * American odds "+138" (2.38) / "-150" (1.67). Null if there are none.
 */
export function parseOdds(text: string | number | null | undefined): number | null {
  if (typeof text === "number") return Number.isFinite(text) && text > 1 ? round2(text) : null;
  const t = (text ?? "").replace(/[−–]/g, "-").replace(/,/g, "").trim();
  const american = t.match(/(?:^|[^\d.])([+-])\s?(\d{3,5})(?![\d.])/) ?? t.match(/^(\+|-)?(\d{3,5})$/);
  if (american) {
    const n = Number(american[2]);
    if (american[1] === "-") return n >= 100 ? round2(1 + 100 / n) : null;
    return n >= 100 ? round2(1 + n / 100) : null;
  }
  const dec = t.match(/(\d+(?:\.\d+)?)/);
  if (!dec) return null;
  const n = Number(dec[1]);
  return Number.isFinite(n) && n > 1 && n < 1000 ? round2(n) : null;
}

/**
 * When a Discord message was posted, from its timestamp as shown, in the
 * viewer's timezone: "Today at 6:52 PM", "Yesterday at 6:52 PM",
 * "6/13/2026 5:00 AM" (12-hour clock = US month/day) or "13/06/2026 05:00"
 * (24-hour clock = day/month). Null if it can't be read.
 */
export function discordDate(text: string | null | undefined, timezone: string, now = new Date()): Date | null {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  const base = DateTime.fromJSDate(now, { zone: timezone });
  const time = (s: string) => {
    const m = s.match(/(\d{1,2}):(\d{2})\s*([AaPp]\.?[Mm]\.?)?/);
    if (!m) return null;
    let hour = Number(m[1]);
    const ampm = m[3]?.toLowerCase().replace(/\./g, "");
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
    return { hour, minute: Number(m[2]), twelveHour: Boolean(ampm) };
  };
  const relative = t.match(/^(today|yesterday)\b(?:\s+at)?\s*(.*)$/i);
  if (relative) {
    const day = relative[1].toLowerCase() === "yesterday" ? base.minus({ days: 1 }) : base;
    const tm = time(relative[2]);
    return day.set({ hour: tm?.hour ?? 12, minute: tm?.minute ?? 0, second: 0, millisecond: 0 }).toJSDate();
  }
  const numeric = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b\s*(.*)$/);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    const year = numeric[3].length === 2 ? 2000 + Number(numeric[3]) : Number(numeric[3]);
    const tm = time(numeric[4]);
    // Discord writes month/day with a 12-hour clock (US) and day/month with a 24-hour clock.
    const monthFirst = a > 12 ? false : b > 12 ? true : (tm?.twelveHour ?? true);
    const [month, day] = monthFirst ? [a, b] : [b, a];
    const dt = DateTime.fromObject({ year, month, day, hour: tm?.hour ?? 12, minute: tm?.minute ?? 0 }, { zone: timezone });
    return dt.isValid ? dt.toJSDate() : null;
  }
  const iso = DateTime.fromISO(t, { zone: timezone });
  return iso.isValid ? iso.toJSDate() : null;
}

/** Same pick by the same tipster posted in the same minute = the same bet. */
export function nbaDedupeKey(tipster: string, pick: string, placedAt: Date): string {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9.+-]+/g, " ").trim();
  const minute = new Date(Math.floor(placedAt.getTime() / 60_000) * 60_000).toISOString();
  return `${norm(tipster)}|${norm(pick)}@${minute}`;
}

/**
 * The game day for a scanned pick that doesn't show one: tomorrow where you
 * are (picks sent today are for tonight's US games, the next day in Sydney),
 * at midday like a date typed in.
 */
export function defaultGameDay(now: Date, timezone: string): Date {
  return DateTime.fromJSDate(now, { zone: timezone }).plus({ days: 1 }).set({ hour: 12, minute: 0, second: 0, millisecond: 0 }).toJSDate();
}
