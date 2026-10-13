import { ExtractionFormatError } from "./normalize";
import { isNbaMarket, type NbaMarket } from "@/lib/nba/parse";

/**
 * Reading NBA picks from screenshots of tipster messages (e.g. Discord):
 * who posted it, when, and each bet's pick, units, odds and bookmaker.
 */

export interface ScannedPick {
  /** Message author as shown, e.g. "Winible Bot", "Tyvan". */
  sender: string | null;
  /** Message timestamp as shown, e.g. "Yesterday at 6:52 PM". */
  postedText: string | null;
  pick: string;
  market: NbaMarket;
  game: string | null;
  /** When the game is, as shown on a slip, e.g. "SAT 8:40PM ET". */
  gameTimeText: string | null;
  /** Team the bet is on (moneyline / spread), or the player's team. */
  team: string | null;
  player: string | null;
  stat: string | null;
  line: number | null;
  side: "OVER" | "UNDER" | null;
  units: number | null;
  /** Odds as written, e.g. "1.72" or "+138". */
  oddsText: string | null;
  /** Bookmaker as written, e.g. "Sportsbet" or "FD". */
  bookmakerText: string | null;
}

const str = (description: string) => ({ type: ["string", "null"], description });
const num = (description: string) => ({ type: ["number", "null"], description });

export const NBA_PICKS_JSON_SCHEMA = {
  type: "object",
  properties: {
    bets: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sender: str("The message author's name shown above or next to the message (e.g. 'Winible Bot', 'Tyvan'). Not an @mention inside the message."),
          postedText: str("The message's timestamp exactly as shown, e.g. 'Yesterday at 6:52 PM', 'Today at 9:05 AM', '6/13/2026 5:00 AM'."),
          pick: { type: "string", description: "The bet in a few words, e.g. 'Knicks to record 8+ consecutive wins', 'De'Aaron Fox Over 1.5 3PM', 'Celtics -4.5'." },
          market: {
            type: "string",
            enum: ["PLAYER_PROP", "MONEYLINE", "SPREAD", "TOTAL", "FUTURE", "PARLAY", "OTHER"],
            description: "PLAYER_PROP for a player's stat (points, threes, rebounds...), MONEYLINE / SPREAD / TOTAL for a game, FUTURE for season-long bets (titles, win streaks, awards), PARLAY for multis.",
          },
          game: str("The game, e.g. 'New York Knicks @ San Antonio Spurs', if shown."),
          gameTimeText: str("When the game is played, exactly as shown (often on a bet slip), e.g. 'SAT 8:40PM ET', 'Tonight 7:30 PM'. Null if not shown - never the message's timestamp."),
          team: str("For a moneyline or spread: the team the bet is on (e.g. 'Celtics'). For a player prop: the player's team if shown. Null otherwise."),
          player: str("For a player prop: the player's full name, e.g. 'De'Aaron Fox'."),
          stat: str("For a player prop: the stat, e.g. '3PM' (made threes), 'PTS', 'REB', 'AST', 'PRA'."),
          line: num("For a player prop or total: the line, e.g. 'O1.5' or '2+ made threes' -> 1.5. For a spread: the handicap with its sign, e.g. 'Celtics -4.5' -> -4.5."),
          side: { type: ["string", "null"], enum: ["OVER", "UNDER", null], description: "OVER for 'O1.5' / 'Over' / '2+', UNDER for 'U' / 'Under'." },
          units: num("Units staked, e.g. '1.5u' -> 1.5."),
          oddsText: str("This bet's odds exactly as written, e.g. '1.72' or '+138'. If several bookmakers' odds are listed, the first."),
          bookmakerText: str("This bet's bookmaker as written, e.g. 'Sportsbet' or 'FD'. 'All on Sportsbet' applies to every bet in the message. If several are listed with odds, the first."),
        },
        required: ["sender", "postedText", "pick", "market", "game", "gameTimeText", "team", "player", "stat", "line", "side", "units", "oddsText", "bookmakerText"],
      },
    },
  },
  required: ["bets"],
} as const;

export const NBA_PICKS_PROMPT = `You are reading a screenshot of NBA betting picks posted by tipsters (usually a Discord message, sometimes with a bet slip under it).
Return every bet in the screenshot, one entry per bet, in order. A message can hold several bets (e.g. "1.5u - knicks 1.72 odds", "1u - Celtics 1.62 odds").
- sender: the author's name above the message (e.g. "Winible Bot", "Tyvan"), the same for every bet in that message. Ignore @mentions.
- postedText: the message's timestamp as shown ("Yesterday at 6:52 PM", "6/13/2026 5:00 AM").
- pick: the bet in a few words, using the message's heading for context (e.g. under "Teams to record 8+ consecutive wins", "1.5u - knicks" is "Knicks to record 8+ consecutive wins").
- units: the stake in units ("0.5u" -> 0.5). oddsText: the odds as written (decimal "1.72" or American "+138"). bookmakerText: where it's placed ("All on Sportsbet" -> "Sportsbet" for each; "+138 FD +137 NV" -> "FD").
- For player props also fill player, stat, line and side ("De'Aaron Fox O1.5 3PM" -> De'Aaron Fox, 3PM, 1.5, OVER). For moneylines and spreads fill team (and line for a spread, e.g. -4.5).
- gameTimeText: when the game is played if shown (e.g. "SAT 8:40PM ET" on a slip). Not the message timestamp.
Use null for anything not shown. Don't invent bets. A bet slip shown under a message is the same bet as the message, not another one.`;

function clean(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t && t.length <= max && !/^(null|n\/a|none|-+)$/i.test(t) ? t : null;
}

function number(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[^\d.-]/g, "")) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 100) / 100 : null;
}

export function normalizeNbaPicks(raw: unknown): ScannedPick[] {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { bets?: unknown }).bets)) {
    throw new ExtractionFormatError("Gemini's reply has no list of bets.");
  }
  return (raw as { bets: unknown[] }).bets
    .slice(0, 50)
    .filter((b): b is Record<string, unknown> => Boolean(b) && typeof b === "object")
    .map((b) => {
      const side = typeof b.side === "string" ? b.side.toUpperCase() : null;
      return {
        sender: clean(b.sender, 60),
        postedText: clean(b.postedText, 60),
        pick: clean(b.pick, 200) ?? "",
        market: isNbaMarket(b.market) ? b.market : "OTHER",
        game: clean(b.game, 120),
        gameTimeText: clean(b.gameTimeText, 60),
        team: clean(b.team, 60),
        player: clean(b.player, 60),
        stat: clean(b.stat, 20),
        line: number(b.line, -500, 500),
        side: side === "OVER" || side === "UNDER" ? side : null,
        units: number(b.units, 0.01, 1000),
        oddsText: clean(b.oddsText, 40),
        bookmakerText: clean(b.bookmakerText, 60),
      } satisfies ScannedPick;
    })
    .filter((b) => b.pick);
}
