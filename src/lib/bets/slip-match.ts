import type { PrismaClient } from "@/generated/prisma/client";
import { comparePlayers } from "@/lib/matching/dedupe";
import { getTailedAccount } from "@/lib/tailing";
import type { Selection } from "@/lib/selection";
import type { SlipReference } from "./slip-play";

/**
 * Bet slips don't say whether a bet was a bot or a personal play, but the
 * uploaded pick screenshot did: so a scanned slip is matched to the same match
 * (same players, about the same time) on your own dashboard, else on the
 * owner's, and takes its play type from there (see slipPlayType).
 */

export interface SlipToMatch {
  player1: string | null;
  player2: string | null;
  startsAt: Date | null;
  /** The slip showed a time (else only the day is known). */
  timeKnown: boolean;
}

const MIN = 60_000;

/**
 * For each slip, the matching match (or null): same players (either order),
 * within 45 minutes of the slip's time (or the same day when it shows no
 * time); your own matches first, then exact names, then the closest in time.
 */
export async function findSlipReferences(prisma: PrismaClient, userId: string, slips: SlipToMatch[]): Promise<(SlipReference | null)[]> {
  const times = slips.flatMap((s) => (s.startsAt && s.player1 && s.player2 ? [s.startsAt.getTime()] : []));
  if (!times.length) return slips.map(() => null);
  const owner = await getTailedAccount(prisma);
  const matches = await prisma.match.findMany({
    where: {
      userId: { in: [...new Set([userId, owner?.id].filter((id): id is string => Boolean(id)))] },
      startsAt: { gte: new Date(Math.min(...times) - 14 * 60 * MIN), lte: new Date(Math.max(...times) + 14 * 60 * MIN) },
    },
    select: { id: true, userId: true, player1: true, player2: true, startsAt: true, competition: true, playType: true, statistics: { select: { selection: true, ouStats: true } } },
    take: 2000,
  });
  return slips.map((slip) => {
    if (!slip.startsAt || !slip.player1 || !slip.player2) return null;
    const at = slip.startsAt.getTime();
    const window = (slip.timeKnown ? 45 : 14 * 60) * MIN;
    const ranked = matches
      .map((m) => ({ m, names: comparePlayers(slip, m), gap: Math.abs(m.startsAt.getTime() - at) }))
      .filter((c) => c.names !== "different" && c.gap <= window)
      .sort((a, b) => Number(b.m.userId === userId) - Number(a.m.userId === userId) || Number(b.names === "same") - Number(a.names === "same") || a.gap - b.gap);
    const best = ranked[0]?.m;
    if (!best) return null;
    return {
      source: best.userId === userId ? "yours" : "owner",
      matchId: best.id,
      player1: best.player1,
      player2: best.player2,
      startsAt: best.startsAt.toISOString(),
      competition: best.competition,
      playType: best.playType as "BOT" | "PERSONAL",
      selection: (best.statistics?.selection as Selection | null) ?? null,
      ouStats: best.statistics?.ouStats ?? null,
    };
  });
}
