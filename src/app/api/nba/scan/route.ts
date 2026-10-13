import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { readScreenshotWithGemini } from "@/lib/gemini/scan-route";
import { NBA_PICKS_JSON_SCHEMA, NBA_PICKS_PROMPT, normalizeNbaPicks } from "@/lib/gemini/nba";
import { bookmakerFor, tipsterFor } from "@/lib/nba/aliases";
import { discordDate, parseOdds } from "@/lib/nba/parse";
import { AUTO_MARKETS, gameTimeFromText } from "@/lib/nba/grade";

export const maxDuration = 120;

/**
 * Read one screenshot of NBA picks (multipart "file") and return the bets on
 * it for review: tipster (from the sender), units, odds (decimal), bookmaker
 * and when it was posted. Nothing is saved, and the image isn't kept.
 */
export const POST = handle((request: Request) =>
  readScreenshotWithGemini(request, NBA_PICKS_PROMPT, NBA_PICKS_JSON_SCHEMA, async ({ raw, settings }) => {
    const now = new Date();
    const bets = normalizeNbaPicks(raw).map((b) => {
      const posted = discordDate(b.postedText, settings.timezone, now);
      // The game's date when the slip shows it (that's what finds the result), else the day it was posted.
      const gameAt = gameTimeFromText(b.gameTimeText, posted ?? now, settings.timezone);
      return {
        ...b,
        tipster: tipsterFor(b.sender, settings.nbaTipsters),
        bookmaker: bookmakerFor(b.bookmakerText, settings.nbaBookmakers),
        odds: parseOdds(b.oddsText),
        placedAt: (gameAt ?? posted)?.toISOString() ?? null,
        // A posted time means "the next game after this"; a game time is the game itself.
        // (Futures and other bets aren't matched to a game: their date is just the day.)
        dateKind: gameAt || !posted || !AUTO_MARKETS.includes(b.market) ? "GAME" : "POSTED",
      };
    });
    return NextResponse.json({ bets });
  }),
);
