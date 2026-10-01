import type { PrismaClient } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { checkSchedule, computeFireAt } from "./schedule";
import { matchDedupeKey, playersKey } from "@/lib/matching/dedupe";
import type { MatchInput, UpdateMatchInput } from "@/lib/validation/match";
import type { MatchDTO } from "@/lib/types";
import { placeBet } from "@/lib/bets/service";

export { ServiceError } from "./service-error";
import { ServiceError } from "./service-error";

export const matchInclude = {
  statistics: true,
  alarm: true,
  bet: true,
  sources: { select: { screenshotId: true } },
  copiedFrom: { select: { id: true, name: true } },
} satisfies Prisma.MatchInclude;

export type MatchWithRelations = Prisma.MatchGetPayload<{ include: typeof matchInclude }>;

export type CreateOutcome =
  | { status: "created"; match: MatchWithRelations; immediate: boolean }
  | { status: "duplicate"; existingId: string; message: string }
  | { status: "similar"; existingId: string; message: string }
  | { status: "invalid"; message: string };

const SIMILAR_WINDOW_MS = 3 * 60 * 60_000;

/** Create one match with its statistics and alarm, refusing duplicates. */
export async function createMatchWithAlarm(
  prisma: PrismaClient,
  userId: string,
  input: MatchInput,
  now = new Date(),
  opts: { copiedFromUserId?: string } = {},
): Promise<CreateOutcome> {
  const startsAt = new Date(input.startsAt);
  const check = checkSchedule(startsAt, input.reminderMinutes, now);
  if (!check.ok) return { status: "invalid", message: check.reason };

  const dedupeKey = matchDedupeKey(input.player1, input.player2, startsAt);
  const exact = await prisma.match.findUnique({ where: { userId_dedupeKey: { userId, dedupeKey } }, select: { id: true } });
  if (exact) {
    return { status: "duplicate", existingId: exact.id, message: `${input.player1} vs ${input.player2} at this time already has an alarm.` };
  }

  if (!input.allowSimilar) {
    const key = playersKey(input.player1, input.player2);
    const nearby = await prisma.match.findMany({
      where: { userId, startsAt: { gte: new Date(startsAt.getTime() - SIMILAR_WINDOW_MS), lte: new Date(startsAt.getTime() + SIMILAR_WINDOW_MS) } },
      select: { id: true, player1: true, player2: true },
    });
    const similar = nearby.find((m) => playersKey(m.player1, m.player2) === key);
    if (similar) {
      return {
        status: "similar",
        existingId: similar.id,
        message: `A match between the same players already exists within 3 hours of this time. Confirm to create it anyway.`,
      };
    }
  }

  const screenshotIds = input.screenshotIds.length
    ? (await prisma.screenshot.findMany({ where: { id: { in: input.screenshotIds }, userId }, select: { id: true } })).map((s) => s.id)
    : [];

  try {
    const match = await prisma.match.create({
      data: {
        player1: input.player1,
        player2: input.player2,
        competition: input.competition,
        startsAt,
        timezone: input.timezone,
        rawTimeText: input.rawTimeText,
        notes: input.notes,
        dedupeKey,
        userId,
        copiedFromUserId: opts.copiedFromUserId ?? null,
        playType: input.playType ?? (input.selection ? "BOT" : "PERSONAL"),
        stakeUnits: input.stakeUnits,
        odds: input.odds,
        statistics: {
          create: {
            selection: input.selection,
            pointsLine: input.pointsLine,
            ouStats: input.ouStats,
            ouHitRate: input.ouHitRate,
            edge: input.edge,
          },
        },
        alarm: {
          create: {
            reminderMinutes: input.reminderMinutes,
            fireAt: check.fireAt,
            nextAttemptAt: check.fireAt,
          },
        },
        sources: { create: screenshotIds.map((screenshotId) => ({ screenshotId })) },
      },
      include: matchInclude,
    });
    return { status: "created", match, immediate: check.immediate };
  } catch (err) {
    // Unique constraint race: another request created the same match.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await prisma.match.findUnique({ where: { userId_dedupeKey: { userId, dedupeKey } }, select: { id: true } });
      return { status: "duplicate", existingId: existing?.id ?? "", message: "This match already has an alarm." };
    }
    throw err;
  }
}

/** Edit match details and/or reminder; reschedules the alarm when timing changes. */
export async function updateMatch(prisma: PrismaClient, userId: string, id: string, input: UpdateMatchInput, now = new Date()): Promise<MatchWithRelations> {
  const existing = await prisma.match.findFirst({ where: { id, userId }, include: matchInclude });
  if (!existing) throw new ServiceError("Match not found.", 404, "not_found");

  const player1 = input.player1 ?? existing.player1;
  const player2 = input.player2 ?? existing.player2;
  const startsAt = input.startsAt ? new Date(input.startsAt) : existing.startsAt;
  const reminderMinutes = input.reminderMinutes ?? existing.alarm?.reminderMinutes ?? 5;
  const timingChanged =
    startsAt.getTime() !== existing.startsAt.getTime() || reminderMinutes !== existing.alarm?.reminderMinutes;

  const dedupeKey = matchDedupeKey(player1, player2, startsAt);
  if (dedupeKey !== existing.dedupeKey) {
    const clash = await prisma.match.findUnique({ where: { userId_dedupeKey: { userId, dedupeKey } }, select: { id: true } });
    if (clash && clash.id !== id) {
      throw new ServiceError("Another alarm already exists for these players at this time.", 409, "duplicate", { existingId: clash.id });
    }
  }

  let alarmUpdate: Prisma.AlarmUpdateWithoutMatchInput | undefined;
  const alarm = existing.alarm;
  const alarmActive = alarm && (alarm.status === "SCHEDULED" || alarm.status === "SENDING" || alarm.status === "FAILED" || alarm.status === "TRIGGERED");
  if (alarm && timingChanged) {
    const fireAt = computeFireAt(startsAt, reminderMinutes);
    if (alarmActive) {
      const check = checkSchedule(startsAt, reminderMinutes, now);
      if (!check.ok) throw new ServiceError(check.reason, 422, "invalid_time");
      alarmUpdate = {
        reminderMinutes,
        fireAt,
        nextAttemptAt: fireAt,
        status: "SCHEDULED",
        generation: { increment: 1 },
        attempts: 0,
        lockedAt: null,
        lastError: null,
        triggeredAt: null,
        completedAt: null,
        ...CLEAR_RINGING,
      };
    } else {
      // Cancelled/completed alarms keep their status; just store the new timing.
      alarmUpdate = { reminderMinutes, fireAt, nextAttemptAt: fireAt };
    }
  }

  const statsFields = ["selection", "pointsLine", "ouStats", "ouHitRate", "edge"] as const;
  const statsUpdate: Record<string, unknown> = {};
  for (const f of statsFields) if (input[f] !== undefined) statsUpdate[f] = input[f];

  try {
    return await prisma.match.update({
      where: { id },
      data: {
        player1,
        player2,
        startsAt,
        dedupeKey,
        ...(input.competition !== undefined ? { competition: input.competition } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.playType !== undefined ? { playType: input.playType } : {}),
        ...(Object.keys(statsUpdate).length
          ? { statistics: { upsert: { create: statsUpdate, update: statsUpdate } } }
          : {}),
        ...(alarmUpdate ? { alarm: { update: alarmUpdate } } : {}),
      },
      include: matchInclude,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ServiceError("Another alarm already exists for these players at this time.", 409, "duplicate");
    }
    throw err;
  }
}

export async function changeAlarmState(
  prisma: PrismaClient,
  userId: string,
  matchId: string,
  action: "cancel" | "reactivate" | "complete" | "placed",
  now = new Date(),
): Promise<MatchWithRelations> {
  const match = await prisma.match.findFirst({ where: { id: matchId, userId }, include: matchInclude });
  if (!match || !match.alarm) throw new ServiceError("Alarm not found.", 404, "not_found");
  const alarm = match.alarm;

  let data: Prisma.AlarmUpdateInput;
  if (action === "cancel") {
    if (alarm.status === "CANCELLED") return match;
    data = { status: "CANCELLED", cancelledAt: now, lockedAt: null, generation: { increment: 1 }, nextRepeatAt: null };
  } else if (action === "complete") {
    data = { status: "COMPLETED", completedAt: now, lockedAt: null, nextRepeatAt: null };
  } else if (action === "placed") {
    // Bet placed before the reminder: record it (stake/odds from the upload),
    // stop any notification (a new generation cancels one being sent) and
    // complete the alarm.
    await placeBet(prisma, userId, matchId, {}, now);
    data = {
      status: "COMPLETED",
      completedAt: now,
      lockedAt: null,
      nextRepeatAt: null,
      ackAt: alarm.ackAt ?? now,
      ackAction: "placed",
      ...(alarm.status === "SCHEDULED" || alarm.status === "SENDING" ? { generation: { increment: 1 } } : {}),
    };
  } else {
    const check = checkSchedule(match.startsAt, alarm.reminderMinutes, now);
    if (!check.ok) throw new ServiceError(`Cannot reactivate: ${check.reason}`, 422, "invalid_time");
    data = {
      status: "SCHEDULED",
      fireAt: check.fireAt,
      nextAttemptAt: check.fireAt,
      generation: { increment: 1 },
      attempts: 0,
      lockedAt: null,
      lastError: null,
      cancelledAt: null,
      triggeredAt: null,
      completedAt: null,
      ...CLEAR_RINGING,
    };
  }
  await prisma.alarm.update({ where: { id: alarm.id }, data });
  return (await prisma.match.findUnique({ where: { id: matchId }, include: matchInclude }))!;
}

/** A rescheduled alarm rings again, so any earlier confirmation is cleared. */
const CLEAR_RINGING = { ackAt: null, ackAction: null, nextRepeatAt: null, repeatCount: 0 } as const;

/**
 * The user confirmed a ringing alarm ("I've placed the bet" or "Skip"):
 * stops the in-app siren and the repeated notifications on every device.
 */
export async function acknowledgeAlarm(
  prisma: PrismaClient,
  userId: string,
  alarmId: string,
  action: "placed" | "skipped",
  now = new Date(),
  bet?: { stake?: number; odds?: number | null },
): Promise<MatchWithRelations> {
  const alarm = await prisma.alarm.findFirst({ where: { id: alarmId, match: { userId } }, select: { matchId: true, ackAt: true } });
  if (!alarm) throw new ServiceError("Alarm not found.", 404, "not_found");
  if (!alarm.ackAt) {
    await prisma.alarm.updateMany({ where: { id: alarmId, ackAt: null }, data: { ackAt: now, ackAction: action, nextRepeatAt: null } });
  }
  // "I've placed the bet" records the bet for profit tracking.
  if (action === "placed") await placeBet(prisma, userId, alarm.matchId, bet ?? {}, now);
  return (await prisma.match.findUnique({ where: { id: alarm.matchId }, include: matchInclude }))!;
}

/** Alarms that are ringing right now: notified, not confirmed, match not started. */
export async function listRingingAlarms(prisma: PrismaClient, userId: string, now = new Date()) {
  const rows = await prisma.match.findMany({
    where: { userId, startsAt: { gt: now }, alarm: { status: "TRIGGERED", ackAt: null } },
    include: matchInclude,
    orderBy: { startsAt: "asc" },
    take: 20,
  });
  return rows.map(toMatchDTO);
}

export async function deleteMatch(prisma: PrismaClient, userId: string, id: string): Promise<void> {
  const res = await prisma.match.deleteMany({ where: { id, userId } });
  if (res.count === 0) throw new ServiceError("Match not found.", 404, "not_found");
}

/** Serialise a match for JSON responses / client components. */
export function toMatchDTO(m: MatchWithRelations): MatchDTO {
  return {
    id: m.id,
    player1: m.player1,
    player2: m.player2,
    competition: m.competition,
    startsAt: m.startsAt.toISOString(),
    timezone: m.timezone,
    rawTimeText: m.rawTimeText,
    notes: m.notes,
    createdAt: m.createdAt.toISOString(),
    screenshotIds: m.sources.map((s) => s.screenshotId),
    playType: m.playType,
    stakeUnits: m.stakeUnits,
    copiedFrom: m.copiedFrom ? { id: m.copiedFrom.id, name: m.copiedFrom.name } : null,
    odds: m.odds,
    bet: m.bet
      ? {
          id: m.bet.id,
          stake: m.bet.stake,
          odds: m.bet.odds,
          result: m.bet.result,
          profit: m.bet.profit,
          placedAt: m.bet.placedAt.toISOString(),
          settledAt: m.bet.settledAt?.toISOString() ?? null,
        }
      : null,
    statistics: {
      selection: m.statistics?.selection ?? null,
      pointsLine: m.statistics?.pointsLine ?? null,
      ouStats: m.statistics?.ouStats ?? null,
      ouHitRate: m.statistics?.ouHitRate ?? null,
      edge: m.statistics?.edge ?? null,
    },
    alarm: m.alarm
      ? {
          id: m.alarm.id,
          status: m.alarm.status,
          reminderMinutes: m.alarm.reminderMinutes,
          fireAt: m.alarm.fireAt.toISOString(),
          attempts: m.alarm.attempts,
          lastError: m.alarm.lastError,
          triggeredAt: m.alarm.triggeredAt?.toISOString() ?? null,
          completedAt: m.alarm.completedAt?.toISOString() ?? null,
          cancelledAt: m.alarm.cancelledAt?.toISOString() ?? null,
          ackAt: m.alarm.ackAt?.toISOString() ?? null,
          ackAction: m.alarm.ackAction === "placed" || m.alarm.ackAction === "skipped" ? m.alarm.ackAction : null,
        }
      : null,
  };
}
