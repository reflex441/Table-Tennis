import type { PrismaClient } from "@/generated/prisma/client";
import { ServiceError } from "@/lib/alarms/service-error";
import { createMatchWithAlarm, SIMILAR_WINDOW_MS } from "@/lib/alarms/service";
import { playersKey } from "@/lib/matching/dedupe";
import { avatarUrl } from "@/lib/auth/accounts";
import { listBetRows, type BetRowWithMatch } from "@/lib/bets/queries";
import { summarize, type ProfitSummary } from "@/lib/bets/profit";
import { getSettings } from "@/lib/settings";
import { matchInputSchema } from "@/lib/validation/match";
import type { MatchStatisticsDTO } from "@/lib/types";

/**
 * "Tailing": every account automatically tails one account - the app owner's
 * (TAILING_ACCOUNT_EMAIL, or the first account created). The Tailing page
 * shows that account's profit page and upcoming bets, and lets you copy
 * those bets to your own dashboard. Emails and screenshots are never shared.
 */

export interface TailAccount {
  id: string;
  name: string;
  avatarUrl: string | null;
  summary: ProfitSummary;
  upcoming: number;
}

export interface TailMatch {
  id: string;
  player1: string;
  player2: string;
  competition: string | null;
  startsAt: string;
  playType: "BOT" | "PERSONAL";
  /** Units of the play (e.g. 1.5 from a "1.5U OVER" badge). */
  stakeUnits: number;
  statistics: MatchStatisticsDTO;
  /** Already on your dashboard (same players and time). */
  copied: boolean;
}

export interface TailProfile {
  account: TailAccount;
  bets: BetRowWithMatch[];
  upcoming: TailMatch[];
  /** You are looking at your own account (what everyone else sees). */
  isSelf: boolean;
}

/** The account everyone tails: TAILING_ACCOUNT_EMAIL, else the first account created. */
export async function getTailedAccount(prisma: PrismaClient): Promise<{ id: string; name: string; avatarUpdatedAt: Date | null } | null> {
  const select = { id: true, name: true, avatarUpdatedAt: true } as const;
  const email = process.env.TAILING_ACCOUNT_EMAIL?.trim().toLowerCase();
  if (email) {
    const byEmail = await prisma.user.findUnique({ where: { email }, select });
    if (byEmail) return byEmail;
  }
  return prisma.user.findFirst({ orderBy: { createdAt: "asc" }, select });
}

/** Upcoming bets of `targetId` that can still be copied. */
async function upcomingMatches(prisma: PrismaClient, targetId: string, now: Date) {
  return prisma.match.findMany({
    where: { userId: targetId, startsAt: { gt: now }, alarm: { is: { status: { not: "CANCELLED" } } } },
    include: { statistics: true },
    orderBy: { startsAt: "asc" },
    take: 100,
  });
}

/**
 * Which of `matches` the viewer already has: same players (either order)
 * within 3 hours - the same rule that stops a copy from being a duplicate.
 */
async function viewerHas(prisma: PrismaClient, viewerId: string, matches: { player1: string; player2: string; startsAt: Date }[]) {
  if (!matches.length) return () => false;
  const times = matches.map((m) => m.startsAt.getTime());
  const mine = await prisma.match.findMany({
    where: {
      userId: viewerId,
      startsAt: { gte: new Date(Math.min(...times) - SIMILAR_WINDOW_MS), lte: new Date(Math.max(...times) + SIMILAR_WINDOW_MS) },
    },
    select: { player1: true, player2: true, startsAt: true },
  });
  return (m: { player1: string; player2: string; startsAt: Date }) => {
    const key = playersKey(m.player1, m.player2);
    return mine.some((o) => playersKey(o.player1, o.player2) === key && Math.abs(o.startsAt.getTime() - m.startsAt.getTime()) <= SIMILAR_WINDOW_MS);
  };
}

/** The tailed account's profit page and upcoming bets, as seen by `viewerId`. */
export async function getTailProfile(prisma: PrismaClient, viewerId: string, now = new Date()): Promise<TailProfile | null> {
  const target = await getTailedAccount(prisma);
  if (!target) return null;
  const [bets, upcoming] = await Promise.all([listBetRows(prisma, target.id), upcomingMatches(prisma, target.id, now)]);
  const isSelf = target.id === viewerId;
  const onDashboard = isSelf ? () => true : await viewerHas(prisma, viewerId, upcoming);
  return {
    isSelf,
    account: { id: target.id, name: target.name, avatarUrl: avatarUrl(target), summary: summarize(bets), upcoming: upcoming.length },
    bets,
    upcoming: upcoming.map((m) => ({
      id: m.id,
      player1: m.player1,
      player2: m.player2,
      competition: m.competition,
      startsAt: m.startsAt.toISOString(),
      playType: m.playType as "BOT" | "PERSONAL",
      stakeUnits: m.stakeUnits && m.stakeUnits > 0 ? m.stakeUnits : 1,
      statistics: {
        selection: m.statistics?.selection ?? null,
        pointsLine: m.statistics?.pointsLine ?? null,
        ouStats: m.statistics?.ouStats ?? null,
        ouHitRate: m.statistics?.ouHitRate ?? null,
        edge: m.statistics?.edge ?? null,
      },
      copied: onDashboard(m),
    })),
  };
}

export interface CopyResult {
  copied: number;
  skipped: { id: string; reason: string }[];
}

/**
 * Copy upcoming bets (all, or the given ids) from the tailed account to your
 * dashboard: same match, pick and stats, with your own default reminder,
 * the play's units (e.g. 1.5u) and your average odds (if ticked, else their odds).
 */
export async function copyBets(prisma: PrismaClient, viewerId: string, matchIds: string[] | null, now = new Date()): Promise<CopyResult> {
  const target = await getTailedAccount(prisma);
  if (!target) throw new ServiceError("There's no account to tail yet.", 404, "not_found");
  if (target.id === viewerId) throw new ServiceError("These are your own bets - they're already on your dashboard.", 400, "self");
  const targetId = target.id;
  const settings = await getSettings(prisma, viewerId);
  const source = (await upcomingMatches(prisma, targetId, now)).filter((m) => !matchIds || matchIds.includes(m.id));
  const result: CopyResult = { copied: 0, skipped: [] };
  for (const m of source) {
    const input = matchInputSchema.parse({
      player1: m.player1,
      player2: m.player2,
      competition: m.competition,
      startsAt: m.startsAt.toISOString(),
      timezone: m.timezone,
      rawTimeText: m.rawTimeText,
      reminderMinutes: settings.defaultReminderMinutes,
      selection: m.statistics?.selection ?? null,
      pointsLine: m.statistics?.pointsLine ?? null,
      ouStats: m.statistics?.ouStats ?? null,
      ouHitRate: m.statistics?.ouHitRate ?? null,
      edge: m.statistics?.edge ?? null,
      playType: m.playType,
      // Same units as the play (e.g. 1.5u), 1u if none were set.
      stakeUnits: m.stakeUnits && m.stakeUnits > 0 ? m.stakeUnits : 1,
      odds: settings.useAverageOdds ? settings.averageOdds : m.odds,
    });
    const out = await createMatchWithAlarm(prisma, viewerId, input, now, { copiedFromUserId: targetId });
    if (out.status === "created") result.copied++;
    else result.skipped.push({ id: m.id, reason: out.status === "invalid" ? out.message : "Already on your dashboard." });
  }
  return result;
}
