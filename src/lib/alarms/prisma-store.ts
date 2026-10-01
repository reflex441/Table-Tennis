import type { PrismaClient } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import type { ClaimedAlarm, DispatcherStore, FinishUpdate, PushResult } from "./dispatcher";
import { STALE_LOCK_MS } from "./dispatcher";
import { getSettings } from "@/lib/settings";

/** Postgres implementation of the dispatcher store. */
export function createPrismaStore(prisma: PrismaClient): DispatcherStore {
  return {
    async claimDue(now, limit) {
      const stale = new Date(now.getTime() - STALE_LOCK_MS);
      // Atomically claim due alarms. FOR UPDATE SKIP LOCKED makes this safe
      // when several dispatchers (web server + worker + cron) run at once.
      const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
        UPDATE "Alarm"
           SET "status" = 'SENDING', "lockedAt" = ${now}, "attempts" = "attempts" + 1, "updatedAt" = ${now}
         WHERE "id" IN (
           SELECT "id" FROM "Alarm"
            WHERE ("status" = 'SCHEDULED' AND "nextAttemptAt" <= ${now})
               OR ("status" = 'SENDING' AND "lockedAt" < ${stale})
            ORDER BY "nextAttemptAt" ASC
            LIMIT ${limit}
            FOR UPDATE SKIP LOCKED
         )
     RETURNING "id"`);
      if (!rows.length) return [];
      const alarms = await prisma.alarm.findMany({
        where: { id: { in: rows.map((r) => r.id) } },
        include: { match: { include: { statistics: true } } },
      });
      return alarms.map<ClaimedAlarm>((a) => ({
        id: a.id,
        generation: a.generation,
        attempts: a.attempts,
        reminderMinutes: a.reminderMinutes,
        fireAt: a.fireAt,
        match: {
          id: a.match.id,
          player1: a.match.player1,
          player2: a.match.player2,
          competition: a.match.competition,
          startsAt: a.match.startsAt,
          statistics: a.match.statistics
            ? {
                selection: a.match.statistics.selection,
                pointsLine: a.match.statistics.pointsLine,
                ouStats: a.match.statistics.ouStats,
                ouHitRate: a.match.statistics.ouHitRate,
                edge: a.match.statistics.edge,
              }
            : null,
        },
      }));
    },

    async getSettings() {
      const s = await getSettings(prisma);
      return {
        timezone: s.timezone,
        pushEnabled: s.pushEnabled,
        inAppEnabled: s.inAppEnabled,
        includeStatsInNotification: s.includeStatsInNotification,
      };
    },

    async getActiveSubscriptions() {
      return prisma.pushSubscription.findMany({
        where: { active: true },
        select: { id: true, endpoint: true, p256dh: true, auth: true },
      });
    },

    async getDeliveredSubscriptionIds(alarmId, generation) {
      const rows = await prisma.notificationDelivery.findMany({
        where: { alarmId, generation, status: "SENT" },
        select: { subscriptionId: true },
      });
      return new Set(rows.map((r) => r.subscriptionId));
    },

    async recordDelivery(alarmId, generation, subscriptionId, result: PushResult) {
      const status = result.ok ? "SENT" : "FAILED";
      const error = result.ok ? null : result.error.slice(0, 500);
      await prisma.notificationDelivery.upsert({
        where: { alarmId_generation_subscriptionId: { alarmId, generation, subscriptionId } },
        create: { alarmId, generation, subscriptionId, status, error, channel: "PUSH" },
        update: { status, error, attempts: { increment: 1 } },
      });
    },

    async markSubscription(subscriptionId, result, now) {
      if (result.ok) {
        await prisma.pushSubscription.update({
          where: { id: subscriptionId },
          data: { lastSuccessAt: now, failureCount: 0, lastError: null },
        });
      } else {
        await prisma.pushSubscription.update({
          where: { id: subscriptionId },
          data: {
            lastFailureAt: now,
            failureCount: { increment: 1 },
            lastError: result.error.slice(0, 500),
            // 404/410 mean the subscription is gone for good.
            ...(result.permanent ? { active: false } : {}),
          },
        });
      }
    },

    async createInAppNotification(alarmId, generation, payload) {
      try {
        await prisma.inAppNotification.create({
          data: { alarmId, generation, matchId: payload.matchId, title: payload.title, body: payload.body, url: payload.url },
        });
        return true;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return false;
        throw err;
      }
    },

    async finishAlarm(alarmId, generation, update: FinishUpdate) {
      const res = await prisma.alarm.updateMany({
        where: { id: alarmId, generation, status: "SENDING" },
        data: {
          status: update.status,
          lockedAt: null,
          lastError: update.lastError,
          ...(update.nextAttemptAt ? { nextAttemptAt: update.nextAttemptAt } : {}),
          ...(update.triggeredAt ? { triggeredAt: update.triggeredAt } : {}),
        },
      });
      return res.count > 0;
    },

    async completeStartedAlarms(now) {
      const res = await prisma.alarm.updateMany({
        where: { status: "TRIGGERED", match: { startsAt: { lte: now } } },
        data: { status: "COMPLETED", completedAt: now },
      });
      return res.count;
    },

    async nextDueAt() {
      const next = await prisma.alarm.findFirst({
        where: { status: "SCHEDULED" },
        orderBy: { nextAttemptAt: "asc" },
        select: { nextAttemptAt: true },
      });
      return next?.nextAttemptAt ?? null;
    },
  };
}
