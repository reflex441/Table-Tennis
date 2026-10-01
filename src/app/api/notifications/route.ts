import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handle } from "@/lib/api";
import type { InAppNotificationDTO } from "@/lib/types";

/** Recent in-app notifications; `?after=<iso>` returns only newer ones. */
export const GET = handle(async (request: Request) => {
  const url = new URL(request.url);
  const afterRaw = url.searchParams.get("after");
  const after = afterRaw ? new Date(afterRaw) : null;
  const prisma = db();
  const rows = await prisma.inAppNotification.findMany({
    where: after && !Number.isNaN(after.getTime()) ? { createdAt: { gt: after } } : {},
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  const unread = await prisma.inAppNotification.count({ where: { readAt: null } });
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
