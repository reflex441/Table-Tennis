import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { readScreenshotWithGemini } from "@/lib/gemini/scan-route";
import { BET_SLIP_JSON_SCHEMA, BET_SLIP_PROMPT, normalizeBetSlips, slipDate } from "@/lib/gemini/betslip";
import { canonicalCompetition } from "@/lib/leagues";
import { guessCompetition, ownerLeagueIndex } from "@/lib/bets/league-guess";

export const maxDuration = 120;

/**
 * Read one bet-slip screenshot (multipart "file") and return the bets on it
 * for review. Nothing is saved: the Profit page adds the ones you keep.
 */
export const POST = handle((request: Request) =>
  readScreenshotWithGemini(request, BET_SLIP_PROMPT, BET_SLIP_JSON_SCHEMA, async ({ raw, settings, prisma }) => {
    const leagues = await ownerLeagueIndex(prisma);
    const bets = normalizeBetSlips(raw).map((b) => {
      // The league printed on the slip, else the one the players played in on the owner's account.
      const fromSlip = canonicalCompetition(b.competition);
      const guessed = fromSlip ? null : guessCompetition(b.player1, b.player2, leagues);
      return {
        ...b,
        competition: fromSlip ?? guessed,
        competitionGuessed: Boolean(guessed),
        startsAt: slipDate(b.dateText, b.timeText, settings.timezone)?.toISOString() ?? null,
      };
    });
    return NextResponse.json({ bets });
  }),
);
