import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handle, parseJson } from "@/lib/api";

const subscribeSchema = z.object({
  endpoint: z.url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

/** Register (or refresh) this browser's push subscription. */
export const POST = handle(async (request: Request) => {
  const sub = await parseJson(request, subscribeSchema);
  const userAgent = request.headers.get("user-agent")?.slice(0, 300) ?? null;
  const row = await db().pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent },
    update: { p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent, active: true, failureCount: 0, lastError: null },
    select: { id: true },
  });
  return NextResponse.json({ id: row.id }, { status: 201 });
});

const unsubscribeSchema = z.object({ endpoint: z.string().min(1).max(2000) });

export const DELETE = handle(async (request: Request) => {
  const { endpoint } = await parseJson(request, unsubscribeSchema);
  await db().pushSubscription.deleteMany({ where: { endpoint } });
  return new NextResponse(null, { status: 204 });
});

export const GET = handle(async () => {
  const rows = await db().pushSubscription.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, userAgent: true, active: true, failureCount: true, lastSuccessAt: true, lastError: true, endpoint: true },
  });
  return NextResponse.json({
    subscriptions: rows.map((r) => ({ ...r, endpoint: undefined, endpointHost: safeHost(r.endpoint) })),
  });
});

function safeHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "unknown";
  }
}
