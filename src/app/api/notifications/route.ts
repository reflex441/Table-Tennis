import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth/current";
import { handle } from "@/lib/api";
import type { InAppNotificationDTO } from "@/lib/types";

/** Recent in-app notifications; `?after=<iso>` returns only newer ones. */
export const GET = handle(async (request: Request) => {
  const url = new URL(request.url);
  const afterRaw = url.searchParams.get("after");
  const after = afterRaw ? new Date(afterRaw) : null;
  const prisma = db();
  const userId = await requireUserId();
  const rows = await prisma.inAppNotification.findMany({
    where: { userId, ...(after && !Number.isNaN(after.getTime()) ? { createdAt: { gt: after } } : {}) },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  const unread = await prisma.inAppNotification.count({ where: { userId, readAt: null } });
  const notifications: InAppNotificationDTO[] = rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    title: r.title,
    body: r.body,
    url: r.url,
    matchId: r.matchId,
    readAt: r.readAt?.toISOString() ?? null,
  }));
  return NextResponse.json({ notifications, unread, serverTime: new Date().toISOString() });
});

/** Clear all of your notifications. */
export const DELETE = handle(async () => {
  const res = await db().inAppNotification.deleteMany({ where: { userId: await requireUserId() } });
  return NextResponse.json({ deleted: res.count });
});
