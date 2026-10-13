import { DateTime } from "luxon";
import type { BetResult } from "@/lib/bets/profit";
import { espnDay, type EspnClient, type EspnGame, type EspnPlayerLine, type EspnTeam } from "./espn";
import type { NbaMarket } from "./parse";
import { STAT_LABEL, statCode, statValue } from "./stats";

export { STAT_CODES, STAT_LABEL, statCode, statValue, type StatCode } from "./stats";

/**
 * Grading NBA bets from ESPN: player props from the box score, moneylines,
 * spreads and totals from the final score. Futures, parlays and anything
 * unclear are left for the user - a bet is only settled when the data
 * clearly says so.
 */

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);
function nameTokens(s: string): string[] {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/[^a-z\s-]/g, " ")
    .replace(/-/g, " ")
    .split(/\s+/)
    .filter((t) => t && !SUFFIXES.has(t));
}

/** The player in a box score: full name, else surname (+ first initial) when only one fits. */
export function findPlayer(name: string, lines: EspnPlayerLine[]): EspnPlayerLine | null {
  const target = nameTokens(name);
  if (!target.length) return null;
  const full = target.join(" ");
  const exact = lines.filter((l) => nameTokens(l.name).join(" ") === full);
  if (exact.length === 1) return exact[0];
  const surname = target[target.length - 1];
  let bySurname = lines.filter((l) => nameTokens(l.name).slice(-1)[0] === surname);
  if (target.length > 1) bySurname = bySurname.filter((l) => nameTokens(l.name)[0]?.[0] === target[0][0]);
  return bySurname.length === 1 ? bySurname[0] : null;
}

/** Nicknames tipsters use. */
const TEAM_ALIASES: Record<string, string[]> = {
  "76ers": ["sixers"],
  "trail blazers": ["blazers"],
  cavaliers: ["cavs"],
  mavericks: ["mavs"],
  timberwolves: ["wolves", "twolves"],
  pelicans: ["pels"],
  warriors: ["dubs"],
  grizzlies: ["grizz"],
  celtics: ["celts"],
};

const plain = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;

/** Does the text mention this team ("knicks", "New York Knicks", "NY @ SA")? */
export function mentionsTeam(text: string, team: Pick<EspnTeam, "displayName" | "name" | "shortDisplayName" | "abbreviation">): boolean {
  if (!text.trim()) return false;
  const p = plain(text);
  const nick = team.name.toLowerCase();
  const words = [team.displayName, team.name, team.shortDisplayName, ...(TEAM_ALIASES[nick] ?? [])].filter((w) => w && w.length >= 3);
  if (words.some((w) => p.includes(plain(w)))) return true;
  // Abbreviations only as written in capitals ("NY @ SA").
  return team.abbreviation.length >= 2 && new RegExp(`(^|[^A-Za-z])${team.abbreviation}([^A-Za-z]|$)`).test(text);
}

export interface Gradable {
  market: NbaMarket;
  pick: string;
  team: string | null;
  game: string | null;
  player: string | null;
  stat: string | null;
  line: number | null;
  side: "OVER" | "UNDER" | null;
  placedAt: Date;
}

export type GradeOutcome =
  | { kind: "settled"; result: Exclude<BetResult, "PENDING">; note: string; eventId: string }
  | { kind: "wait"; note: string; eventId?: string }
  | { kind: "manual"; note: string };

export const AUTO_MARKETS: NbaMarket[] = ["PLAYER_PROP", "MONEYLINE", "SPREAD", "TOTAL"];

const scoreLine = (g: EspnGame) => {
  const away = g.teams.find((t) => t.homeAway === "away") ?? g.teams[0];
  const home = g.teams.find((t) => t.homeAway === "home") ?? g.teams[1];
  return `${away.name || away.displayName} ${away.score ?? "?"} - ${home.score ?? "?"} ${home.name || home.displayName}`;
};

const isOff = (g: EspnGame) => /POSTPONED|CANCEL|SUSPENDED|FORFEIT/i.test(g.statusName);
const isFinal = (g: EspnGame) => g.state === "post" && g.completed && !isOff(g);

/** Over/under against a line; equal = push (void). */
function overUnder(value: number, line: number, side: "OVER" | "UNDER"): Exclude<BetResult, "PENDING"> {
  if (value === line) return "VOID";
  return (side === "OVER" ? value > line : value < line) ? "WON" : "LOST";
}

/**
 * Settle one bet from ESPN, or say why not yet. Looks at games on the bet's
 * date and the day after (US time), from 3 hours before its time onwards.
 */
export async function gradeBet(bet: Gradable, espn: EspnClient, now = new Date()): Promise<GradeOutcome> {
  if (!AUTO_MARKETS.includes(bet.market)) return { kind: "manual", note: "Futures, parlays and other bets are marked by you." };
  const from = bet.placedAt.getTime() - 3 * 3_600_000;
  const days = [...new Set([espnDay(bet.placedAt), espnDay(new Date(bet.placedAt.getTime() + 24 * 3_600_000))])];
  const games = (await Promise.all(days.map((d) => espn.scoreboard(d)))).flat().filter((g) => g.startsAt.getTime() >= from);
  games.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const stale = now.getTime() - bet.placedAt.getTime() > 2 * 24 * 3_600_000;
  const notFound = (what: string): GradeOutcome =>
    stale ? { kind: "manual", note: `Couldn't find ${what} on ESPN - mark it yourself.` } : { kind: "wait", note: `Looking for ${what} on ESPN.` };

  const teamText = [bet.team, bet.game, bet.pick].filter(Boolean).join(" | ");

  if (bet.market === "PLAYER_PROP") {
    if (!bet.player) return { kind: "manual", note: "Add the player to grade it automatically." };
    const code = statCode(bet.stat) ?? statCode(bet.pick);
    if (!code) return { kind: "manual", note: "Add the stat (e.g. 3PM, PTS) to grade it automatically." };
    if (bet.line === null) return { kind: "manual", note: "Add the line (e.g. 1.5) to grade it automatically." };
    // The player's game: the team's game when known, else look through that day's box scores.
    const teamGames = bet.team || bet.game ? games.filter((g) => g.teams.some((t) => mentionsTeam([bet.team, bet.game].filter(Boolean).join(" | "), t))) : [];
    const candidates = teamGames.length ? teamGames.slice(0, 1) : games;
    for (const g of candidates) {
      if (g.state === "pre" || isOff(g)) continue;
      const line = findPlayer(bet.player, await espn.boxScore(g.id));
      if (!line) continue;
      if (!isFinal(g)) return { kind: "wait", note: `Waiting for the final score (${scoreLine(g)}).`, eventId: g.id };
      if (line.didNotPlay || !line.stats) return { kind: "settled", result: "VOID", note: `${line.name} didn't play - void.`, eventId: g.id };
      const value = statValue(code, line.stats);
      const result = overUnder(value, bet.line, bet.side ?? "OVER");
      return { kind: "settled", result, note: `${line.name}: ${value} ${STAT_LABEL[code]} (line ${bet.line}).`, eventId: g.id };
    }
    if (candidates.some((g) => g.state === "pre")) return { kind: "wait", note: "Waiting for the game to start." };
    return notFound(bet.player);
  }

  // Game bets: the first game of a team the bet mentions.
  const game = games.find((g) => g.teams.some((t) => mentionsTeam(teamText, t)));
  if (!game) return notFound("the game");
  if (isOff(game)) return { kind: "manual", note: `Game ${game.statusName.replace("STATUS_", "").toLowerCase()} - check with your bookmaker.` };
  if (!isFinal(game)) return { kind: "wait", note: game.state === "in" ? `Waiting for the final score (${scoreLine(game)}).` : "Waiting for the game to start.", eventId: game.id };
  const [a, b] = game.teams;
  if (a.score === null || b.score === null) return { kind: "wait", note: "Waiting for the final score.", eventId: game.id };
  const final = `Final: ${scoreLine(game)}.`;

  if (bet.market === "TOTAL") {
    if (bet.line === null || !bet.side) return { kind: "manual", note: "Add the line and Over/Under to grade it automatically." };
    const total = a.score + b.score;
    return { kind: "settled", result: overUnder(total, bet.line, bet.side), note: `${total} points in total. ${final}`, eventId: game.id };
  }

  // Moneyline / spread: the team the bet is on (the team box, else the only team in the pick).
  const backed = game.teams.filter((t) => mentionsTeam(bet.team || bet.pick, t));
  if (backed.length !== 1) return { kind: "manual", note: "Add the team the bet is on to grade it automatically." };
  const team = backed[0];
  const other = game.teams.find((t) => t !== team)!;
  const margin = team.score! - other.score!;
  if (bet.market === "MONEYLINE") {
    return { kind: "settled", result: margin > 0 ? "WON" : "LOST", note: `${team.name || team.displayName} ${margin > 0 ? "won" : "lost"}. ${final}`, eventId: game.id };
  }
  if (bet.line === null) return { kind: "manual", note: "Add the spread (e.g. -4.5) to grade it automatically." };
  const covered = margin + bet.line;
  return {
    kind: "settled",
    result: covered > 0 ? "WON" : covered < 0 ? "LOST" : "VOID",
    note: `${team.name || team.displayName} ${bet.line > 0 ? "+" : ""}${bet.line}: ${margin > 0 ? "won" : "lost"} by ${Math.abs(margin)}. ${final}`,
    eventId: game.id,
  };
}

const ZONES: Record<string, string> = {
  ET: "America/New_York",
  EST: "America/New_York",
  EDT: "America/New_York",
  CT: "America/Chicago",
  CST: "America/Chicago",
  CDT: "America/Chicago",
  MT: "America/Denver",
  MST: "America/Denver",
  MDT: "America/Denver",
  PT: "America/Los_Angeles",
  PST: "America/Los_Angeles",
  PDT: "America/Los_Angeles",
  AEDT: "Australia/Sydney",
  AEST: "Australia/Sydney",
};
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * When the game is, from what a slip shows ("SAT 8:40PM ET", "Tonight 7:30 PM",
 * "Oct 12 7:00 PM ET"), relative to when the pick was posted. Null if it
 * doesn't say.
 */
export function gameTimeFromText(text: string | null | undefined, postedAt: Date, timezone: string): Date | null {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  const zoneTag = t.match(/\b(ET|EST|EDT|CT|CST|CDT|MT|MST|MDT|PT|PST|PDT|AEDT|AEST)\b/i)?.[1].toUpperCase();
  const zone = zoneTag ? ZONES[zoneTag] : timezone;
  const base = DateTime.fromJSDate(postedAt, { zone }).startOf("day");
  const tm = t.match(/(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?/i) ?? t.match(/\b(\d{1,2}):(\d{2})\b/);
  let hour = 12;
  let minute = 0;
  if (tm) {
    hour = Number(tm[1]) % (tm[3] ? 12 : 24);
    if (tm[3]?.toLowerCase() === "p") hour += 12;
    minute = Number(tm[2] ?? 0);
  }
  const lower = t.toLowerCase();
  let day: DateTime | null = null;
  const monthDay = lower.match(new RegExp(`\\b(${MONTHS.join("|")})[a-z]*\\.? (\\d{1,2})\\b`));
  const numeric = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (/\b(today|tonight)\b/.test(lower)) day = base;
  else if (/\btomorrow\b/.test(lower)) day = base.plus({ days: 1 });
  else if (monthDay) day = base.set({ month: MONTHS.indexOf(monthDay[1]) + 1, day: Number(monthDay[2]) });
  else if (numeric) {
    // US slips write month/day.
    const [m, d] = Number(numeric[1]) > 12 ? [Number(numeric[2]), Number(numeric[1])] : [Number(numeric[1]), Number(numeric[2])];
    day = base.set({ month: m, day: d });
  } else {
    const wd = lower.match(new RegExp(`\\b(${WEEKDAYS.join("|")})[a-z]*\\b`));
    if (wd) {
      const target = WEEKDAYS.indexOf(wd[1]) + 1;
      day = base.plus({ days: (target - base.weekday + 7) % 7 });
    }
  }
  if (!day && tm) {
    // Just a time: the next one after the pick was posted.
    const sameDay = base.set({ hour, minute });
    return (sameDay.toMillis() < postedAt.getTime() - 3 * 3_600_000 ? sameDay.plus({ days: 1 }) : sameDay).toJSDate();
  }
  if (!day || !day.isValid) return null;
  // A date that already passed long ago is next year's (e.g. "Jan 3" posted in December).
  if (day < base.minus({ days: 60 })) day = day.plus({ years: 1 });
  return day.set({ hour, minute }).toJSDate();
}
