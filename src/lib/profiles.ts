import type { PrismaClient } from "@/generated/prisma/client";
import { avatarUrl } from "@/lib/auth/accounts";
import { listBetRows, type BetRowWithMatch } from "@/lib/bets/queries";
import { summarize, type ProfitSummary } from "@/lib/bets/profit";

export interface PublicProfile {
  account: { id: string; name: string; avatarUrl: string | null; summary: ProfitSummary };
  bets: BetRowWithMatch[];
}

/**
 * Someone's profit page, opened from the leaderboard. Only accounts shown on
 * the leaderboard can be viewed (turning off "Show me on the leaderboard"
 * hides it too); emails, screenshots and settings are never included.
 */
export async function getPublicProfile(prisma: PrismaClient, targetId: string): Promise<PublicProfile | null> {
  const user = await prisma.user.findUnique({
    where: { id: targetId },
    select: { id: true, name: true, avatarUpdatedAt: true, settings: { select: { showOnLeaderboard: true } } },
  });
  if (!user || user.settings?.showOnLeaderboard === false) return null;
  const bets = await listBetRows(prisma, user.id);
  return { account: { id: user.id, name: user.name, avatarUrl: avatarUrl(user), summary: summarize(bets) }, bets };
}
