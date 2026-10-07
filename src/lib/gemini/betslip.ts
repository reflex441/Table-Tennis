import { DateTime } from "luxon";
import { isSelection, type Selection } from "@/lib/selection";
import { ExtractionFormatError } from "./normalize";
import { shortPlayerName } from "@/lib/matching/player-names";

/**
 * Reading bookmaker bet slips ("My Bets" / settled bets screenshots from
 * Ladbrokes, Sportsbet, ...) to add past bets to the Profit page.
 * "Win" = won, "No Return" = lost.
 */

export type SlipResult = "WON" | "LOST" | "VOID" | "PENDING";

export interface SlipBet {
  player1: string | null;
  player2: string | null;
  competition: string | null;
  selection: Selection | null;
  pointsLine: number | null;
  odds: number | null;
  /** Stake in money, as shown on the slip (e.g. $20 -> 20). */
  stake: number | null;
  result: SlipResult;
  /** The result text as shown, e.g. "No Return". */
  resultText: string | null;
  dateText: string | null;
  timeText: string | null;
}

const str = (description: string) => ({ type: ["string", "null"], description });
const num = (description: string) => ({ type: ["number", "null"], description });

export const BET_SLIP_JSON_SCHEMA = {
  type: "object",
  properties: {
    bets: {
      type: "array",
      items: {
        type: "object",
        properties: {
          player1: str("First player's name as shown (e.g. 'Blazej Warpas' from 'Blazej Warpas vs Frantisek Krcil')."),
          player2: str("Second player's name."),
          competition: str("League / competition if shown (usually 'TT Elite Series', 'TT Cup' or 'Czech Liga Pro'). Null if not shown."),
          selection: { type: ["string", "null"], enum: ["OVER", "UNDER", "SWEEP", null], description: "OVER for an Over bet (e.g. 'Over 73.5'), UNDER for an Under bet. Null for other markets." },
          pointsLine: num("The total points line, e.g. 'Over 73.5' -> 73.5."),
          odds: num("Decimal odds of the bet, e.g. '@ 1.80' -> 1.8."),
          stake: num("Stake amount in money without the currency sign, e.g. 'Stake $20.00' -> 20."),
          resultText: str("The settlement shown on the slip exactly, e.g. 'Win', 'Won', 'No Return', 'Lost', 'Refund', 'Void'. Null if the bet is still open / pending."),
          dateText: str("Date shown for the bet or event, verbatim, e.g. 'Fri 2 Oct', '02/10/2026', 'Friday 2nd October 2026'."),
          timeText: str("Time shown for the bet or event, verbatim, e.g. '4:55 PM'."),
        },
        required: ["player1", "player2", "competition", "selection", "pointsLine", "odds", "stake", "resultText", "dateText", "timeText"],
      },
    },
  },
  required: ["bets"],
} as const;

export const BET_SLIP_PROMPT = `You are reading a screenshot of bookmaker bet slips (e.g. Ladbrokes or Sportsbet "My Bets" / "Settled" / "Resulted" bets) for table tennis.
Return every bet visible in the screenshot, one entry per bet, in order.
- player1 / player2: the two players of the match ("A vs B").
- selection: OVER for "Over 73.5", UNDER for "Under 73.5" (total points markets). Null for other markets (head to head, handicap...).
- pointsLine: the number after Over/Under. odds: the decimal odds of the bet. stake: the amount staked, without the currency sign.
- resultText: copy the settlement exactly: "Win"/"Won" (and a return amount) means the bet won; "No Return" means it lost; "Refund"/"Void" means void. Null if the bet hasn't been settled yet.
- dateText / timeText: copy the date and time shown for the bet verbatim. Don't convert or guess.
Use null for anything you can't read. Don't invent bets.`;

/** "Win" / "No Return" / "Refund" -> result. */
export function slipResult(text: string | null | undefined): SlipResult {
  const t = (text ?? "").trim().toLowerCase();
  if (!t) return "PENDING";
  if (/no\s*return|\blost\b|\bloss\b|\blose\b/.test(t)) return "LOST";
  if (/refund|void|push|cancel|scratch/.test(t)) return "VOID";
  if (/\bwin\b|\bwon\b|\bwinner\b|\bpaid\b|collect/.test(t)) return "WON";
  return "PENDING";
}

function clean(v: unknown, max = 80): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t && t.length <= max && !/^(null|n\/a|none|-+)$/i.test(t) ? t : null;
}

function number(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[$,\s]/g, "")) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 100) / 100 : null;
}

/** "Mariusz Koczyba" -> "Koczyba M.", like the rest of the app. */
const short = (name: string | null) => (name ? shortPlayerName(name) : null);

export function normalizeBetSlips(raw: unknown): SlipBet[] {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { bets?: unknown }).bets)) {
    throw new ExtractionFormatError("Gemini's reply has no list of bets.");
  }
  return ((raw as { bets: unknown[] }).bets ?? [])
    .slice(0, 50)
    .filter((b): b is Record<string, unknown> => Boolean(b) && typeof b === "object")
    .map((b): SlipBet => {
      const sel = typeof b.selection === "string" ? b.selection.toUpperCase() : null;
      const resultText = clean(b.resultText, 40);
      return {
        player1: short(clean(b.player1, 60)),
        player2: short(clean(b.player2, 60)),
        competition: clean(b.competition, 120),
        selection: isSelection(sel) ? sel : null,
        pointsLine: number(b.pointsLine, 0, 500),
        odds: number(b.odds, 1.0001, 1000),
        stake: number(b.stake, 0.01, 1_000_000),
        result: slipResult(resultText),
        resultText,
        dateText: clean(b.dateText, 60),
        timeText: clean(b.timeText, 30),
      };
    })
    .filter((b) => b.player1 || b.player2);
}

const DATE_FORMATS = [
  "d MMM yyyy", "d MMMM yyyy", "ccc d MMM yyyy", "cccc d MMMM yyyy", "ccc, d MMM yyyy",
  "dd/MM/yyyy", "d/M/yyyy", "dd.MM.yyyy", "d.M.yyyy", "yyyy-MM-dd", "dd/MM/yy", "d/M/yy",
  "cccc d MMM yyyy", "cccc, d MMM yyyy",
];
const DATE_FORMATS_NO_YEAR = ["d MMM", "d MMMM", "ccc d MMM", "cccc d MMM", "cccc d MMMM", "ccc, d MMM", "cccc, d MMM", "dd/MM", "d/M"];
const TIME_FORMATS = ["h:mm a", "h:mma", "h:mm:ss a", "HH:mm", "H:mm", "HH:mm:ss"];

/**
 * When the bet was, from the slip's date/time text, in the user's timezone.
 * Missing year: this year (last year if that would be in the future).
 * Missing time: midday. Missing date: null (the user picks it).
 */
export function slipDate(dateText: string | null, timeText: string | null, timezone: string, now = new Date()): Date | null {
  if (!dateText) return null;
  const d = dateText.replace(/(\d+)(st|nd|rd|th)\b/gi, "$1").replace(/\s+/g, " ").trim();
  const opts = { zone: timezone, locale: "en-AU" };
  let date: DateTime | null = null;
  for (const f of DATE_FORMATS) {
    const dt = DateTime.fromFormat(d, f, opts);
    if (dt.isValid) {
      date = dt;
      break;
    }
  }
  if (!date) {
    const nowDt = DateTime.fromJSDate(now, { zone: timezone });
    for (const f of DATE_FORMATS_NO_YEAR) {
      const dt = DateTime.fromFormat(d, f, opts);
      if (dt.isValid) {
        let withYear = dt.set({ year: nowDt.year });
        if (withYear > nowDt.plus({ days: 1 })) withYear = withYear.minus({ years: 1 });
        date = withYear;
        break;
      }
    }
  }
  if (!date) return null;
  let hour = 12;
  let minute = 0;
  // "6:40am (AEDT)" -> "6:40AM": drop a timezone in brackets or at the end.
  const t = (timeText ?? "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(AEDT|AEST|ACDT|ACST|AWST|NZDT|NZST|GMT|UTC)([+-]\d+)?\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    .replace(/\.(?=M)/g, "");
  for (const f of TIME_FORMATS) {
    const tm = DateTime.fromFormat(t, f, { locale: "en-AU" });
    if (t && tm.isValid) {
      hour = tm.hour;
      minute = tm.minute;
      break;
    }
  }
  return date.set({ hour, minute, second: 0, millisecond: 0 }).toJSDate();
}
