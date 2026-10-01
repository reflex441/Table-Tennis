import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handle } from "@/lib/api";
import { createWebPushSender } from "@/lib/push/web-push";
import { createPrismaStore } from "@/lib/alarms/prisma-store";
import type { NotificationPayload } from "@/lib/alarms/notification-content";

/** Send a test notification to every subscribed device and the in-app centre. */
export const POST = handle(async () => {
  const prisma = db();
  const payload: NotificationPayload = {
    title: "Test notification",
    body: "Varcl J vs Jan S - Czech Liga Pro\nOVER | O/U 20/9 - 69% | EDGE 47%",
    url: "/settings",
    tag: `test-${Date.now()}`,
    matchId: "",
    alarmId: null,
  };
  await prisma.inAppNotification.create({ data: { title: payload.title, body: payload.body, url: payload.url } });

  const sender = createWebPushSender();
  const subs = await prisma.pushSubscription.findMany({ where: { active: true } });
  const store = createPrismaStore(prisma);
  const results = [];
  if (sender) {
    for (const sub of subs) {
      const result = await sender.send(sub, payload, 300);
      await store.markSubscription(sub.id, result, new Date());
      results.push({ id: sub.id, ok: result.ok, error: result.ok ? null : result.error, statusCode: result.ok ? null : result.statusCode ?? null });
    }
  }
  return NextResponse.json({
    pushConfigured: Boolean(sender),
    devices: subs.length,
    sent: results.filter((r) => r.ok).length,
    results,
  });
});
