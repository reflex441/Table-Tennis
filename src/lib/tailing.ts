import type { PrismaClient } from "@/generated/prisma/client";
import { ServiceError } from "@/lib/alarms/service-error";
import { createMatchWithAlarm } from "@/lib/alarms/service";
import { avatarUrl } from "@/lib/auth/accounts";
import { listBetRows, type BetRowWithMatch } from "@/lib/bets/queries";
import { summarize, type ProfitSummary } from "@/lib/bets/profit";
import { getSettings } from "@/lib/settings";
import { matchInputSchema } from "@/lib/validation/match";
import type { MatchStatisticsDTO } from "@/lib/types";

/**
 * "Tailing": follow other accounts, see their profit page and bets, and copy
 * their upcoming bets to your own dashboard. Accounts can turn this off
 * (Settings → Account → Let others tail me). Emails and screenshots are
 * never shared.
 */

export interface TailAccount {
  id: string;
  name: string;
  avatarUrl: string | null;
  tailed: boolean;
  /** False when the account has turned tailing off (only shown if you already tailed them). */
  open: boolean;
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
  statistics: MatchStatisticsDTO;
  /** Already on your dashboard (same players and time). */
  copied: boolean;
}

export interface TailProfile {
  account: TailAccount;
  bets: BetRowWithMatch[];
  upcoming: TailMatch[];
}

async function openAccounts(prisma: PrismaClient, ids: string[]): Promise<Set<string>> {
  // No settings row yet means the default (tailing allowed).
  const closed = await prisma.settings.findMany({ where: { userId: { in: ids }, allowTailing: false }, select: { userId: true } });
  const closedIds = new Set(closed.map((c) => c.userId));
  return new Set(ids.filter((id) => !closedIds.has(id)));
}

/** Throws unless `viewerId` may see `targetId`'s profit and bets. */
export async function assertCanTail(prisma: PrismaClient, viewerId: string, targetId: string): Promise<void> {
  if (viewerId === targetId) throw new ServiceError("That's you - your own bets are on your dashboard.", 400, "self");
  const exists = await prisma.user.count({ where: { id: targetId } });
  if (!exists || !(await openAccounts(prisma, [targetId])).has(targetId)) {
    throw new ServiceError("This account isn't available to tail.", 404, "not_found");
  }
}

async function upcomingCounts(prisma: PrismaClient, ids: string[], now: Date): Promise<Map<string, number>> {
  const rows = await prisma.match.groupBy({
    by: ["userId"],
    where: { userId: { in: ids }, startsAt: { gt: now }, alarm: { is: { status: { not: "CANCELLED" } } } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.userId ?? "", r._count._all]));
}

async function buildAccounts(prisma: PrismaClient, viewerId: string, ids: string[], now: Date): Promise<TailAccount[]> {
  if (!ids.length) return [];
  const [users, open, tailed, upcoming] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, avatarUpdatedAt: true } }),
    openAccounts(prisma, ids),
    prisma.follow.findMany({ where: { followerId: viewerId, followeeId: { in: ids } }, select: { followeeId: true } }),
    upcomingCounts(prisma, ids, now),
  ]);
  const tailedIds = new Set(tailed.map((t) => t.followeeId));
  const out: TailAccount[] = [];
  for (const u of users) {
    const isOpen = open.has(u.id);
    const rows = isOpen ? await listBetRows(prisma, u.id) : [];
    out.push({
      id: u.id,
      name: u.name,
      avatarUrl: avatarUrl(u),
      tailed: tailedIds.has(u.id),
      open: isOpen,
      summary: summarize(rows),
      upcoming: isOpen ? (upcoming.get(u.id) ?? 0) : 0,
    });
  }
  return out;
}

/** Accounts you tail, and other accounts you could tail. */
export async function listTailing(prisma: PrismaClient, viewerId: string, now = new Date()): Promise<{ tailing: TailAccount[]; others: TailAccount[] }> {
  const follows = await prisma.follow.findMany({ where: { followerId: viewerId }, select: { followeeId: true }, orderBy: { createdAt: "asc" } });
  const tailingIds = follows.map((f) => f.followeeId);
  const candidates = await prisma.user.findMany({
    where: { id: { notIn: [viewerId, ...tailingIds] } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  const open = await openAccounts(prisma, candidates.map((c) => c.id));
  const [tailing, others] = await Promise.all([
    buildAccounts(prisma, viewerId, tailingIds, now),
    buildAccounts(prisma, viewerId, [...open], now),
  ]);
  const byProfit = (a: TailAccount, b: TailAccount) => b.summary.profit - a.summary.profit;
  return { tailing: tailing.sort(byProfit), others: others.sort(byProfit) };
}

export async function tail(prisma: PrismaClient, viewerId: string, targetId: string): Promise<void> {
  await assertCanTail(prisma, viewerId, targetId);
  await prisma.follow.createMany({ data: [{ followerId: viewerId, followeeId: targetId }], skipDuplicates: true });
}

export async function untail(prisma: PrismaClient, viewerId: string, targetId: string): Promise<void> {
  await prisma.follow.deleteMany({ where: { followerId: viewerId, followeeId: targetId } });
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

/** Someone's profit page and upcoming bets, as seen by a viewer who may tail them. */
export async function getTailProfile(prisma: PrismaClient, viewerId: string, targetId: string, now = new Date()): Promise<TailProfile> {
  await assertCanTail(prisma, viewerId, targetId);
  const [[account], bets, upcoming] = await Promise.all([
    buildAccounts(prisma, viewerId, [targetId], now),
    listBetRows(prisma, targetId),
    upcomingMatches(prisma, targetId, now),
  ]);
  const mine = await prisma.match.findMany({
    where: { userId: viewerId, dedupeKey: { in: upcoming.map((m) => m.dedupeKey) } },
    select: { dedupeKey: true },
  });
  const have = new Set(mine.map((m) => m.dedupeKey));
  return {
    account,
    bets,
    upcoming: upcoming.map((m) => ({
      id: m.id,
      player1: m.player1,
      player2: m.player2,
      competition: m.competition,
      startsAt: m.startsAt.toISOString(),
      playType: m.playType as "BOT" | "PERSONAL",
      statistics: {
        selection: m.statistics?.selection ?? null,
        pointsLine: m.statistics?.pointsLine ?? null,
        ouStats: m.statistics?.ouStats ?? null,
        ouHitRate: m.statistics?.ouHitRate ?? null,
        edge: m.statistics?.edge ?? null,
      },
      copied: have.has(m.dedupeKey),
    })),
  };
}

export interface CopyResult {
  copied: number;
  skipped: { id: string; reason: string }[];
}

/**
 * Copy upcoming bets (all, or the given ids) from a tailed account to your
 * dashboard: same match, pick and stats, with your own default reminder,
 * a 1u stake and your average odds (if ticked, else their odds).
 */
export async function copyBets(prisma: PrismaClient, viewerId: string, targetId: string, matchIds: string[] | null, now = new Date()): Promise<CopyResult> {
  await assertCanTail(prisma, viewerId, targetId);
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
      stakeUnits: 1,
      odds: settings.useAverageOdds ? settings.averageOdds : m.odds,
    });
    const out = await createMatchWithAlarm(prisma, viewerId, input, now, { copiedFromUserId: targetId });
    if (out.status === "created") result.copied++;
    else result.skipped.push({ id: m.id, reason: out.status === "invalid" ? out.message : "Already on your dashboard." });
  }
  return result;
}
