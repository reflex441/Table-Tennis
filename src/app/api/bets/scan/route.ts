import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { readScreenshotWithGemini } from "@/lib/gemini/scan-route";
import { BET_SLIP_JSON_SCHEMA, BET_SLIP_PROMPT, normalizeBetSlips, slipDate } from "@/lib/gemini/betslip";
import { canonicalCompetition } from "@/lib/leagues";
import { guessCompetition, ownerLeagueIndex } from "@/lib/bets/league-guess";
import { findSlipReferences } from "@/lib/bets/slip-match";
import { slipPlayType } from "@/lib/bets/slip-play";

export const maxDuration = 120;

/**
 * Read one bet-slip screenshot (multipart "file") and return the bets on it
 * for review. Nothing is saved: the Profit page adds the ones you keep.
 */
export const POST = handle((request: Request) =>
  readScreenshotWithGemini(request, BET_SLIP_PROMPT, BET_SLIP_JSON_SCHEMA, async ({ raw, settings, prisma, userId }) => {
    const leagues = await ownerLeagueIndex(prisma);
    const slips = normalizeBetSlips(raw).map((b) => ({ ...b, at: slipDate(b.dateText, b.timeText, settings.timezone) }));
    // The same match on your dashboard or the owner's (the uploaded bot plays) says whether it was a bot play.
    const refs = await findSlipReferences(
      prisma,
      userId,
      slips.map((b) => ({ player1: b.player1, player2: b.player2, startsAt: b.at, timeKnown: Boolean(b.timeText) })),
    );
    const bets = slips.map(({ at, ...b }, i) => {
      const ref = refs[i];
      // The league printed on the slip, else the matched match's, else the one the players played in on the owner's account.
      const fromSlip = canonicalCompetition(b.competition) ?? canonicalCompetition(ref?.competition);
      const guessed = fromSlip ? null : guessCompetition(b.player1, b.player2, leagues);
      return {
        ...b,
        competition: fromSlip ?? guessed,
        competitionGuessed: Boolean(guessed),
        startsAt: at?.toISOString() ?? null,
        reference: ref,
        // Bot only when it lines up with a bot play (same players, time and pick); everything else is personal.
        playType: slipPlayType(ref, b.selection),
      };
    });
    return NextResponse.json({ bets });
  }),
);
