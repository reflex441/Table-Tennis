import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth/current";
import { handle, parseJson } from "@/lib/api";

const subscribeSchema = z.object({
  endpoint: z.url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
  /** Sent by the browser; falls back to the user agent. */
  deviceType: z.enum(["desktop", "mobile"]).optional(),
});

/** Phones get one normal notification; computers ring until confirmed. */
function deviceTypeFrom(userAgent: string | null): "desktop" | "mobile" {
  return userAgent && /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent) ? "mobile" : "desktop";
}

/** Register (or refresh) this browser's push subscription. */
export const POST = handle(async (request: Request) => {
  const userId = await requireUserId();
  const sub = await parseJson(request, subscribeSchema);
  const userAgent = request.headers.get("user-agent")?.slice(0, 300) ?? null;
  const deviceType = sub.deviceType ?? deviceTypeFrom(userAgent);
  // A browser belongs to whoever is signed in on it now.
  const row = await db().pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent, deviceType, userId },
    update: { p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent, deviceType, userId, active: true, failureCount: 0, lastError: null },
    select: { id: true },
  });
  return NextResponse.json({ id: row.id }, { status: 201 });
});

const unsubscribeSchema = z.object({ endpoint: z.string().min(1).max(2000) });

export const DELETE = handle(async (request: Request) => {
  const { endpoint } = await parseJson(request, unsubscribeSchema);
  await db().pushSubscription.deleteMany({ where: { endpoint, userId: await requireUserId() } });
  return new NextResponse(null, { status: 204 });
});

export const GET = handle(async () => {
  const rows = await db().pushSubscription.findMany({
    where: { userId: await requireUserId() },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, userAgent: true, deviceType: true, active: true, failureCount: true, lastSuccessAt: true, lastError: true, endpoint: true },
  });
  return NextResponse.json({
    // endpointId lets a browser recognise its own entry without exposing the endpoint.
    subscriptions: rows.map((r) => ({ ...r, endpoint: undefined, endpointHost: safeHost(r.endpoint), endpointId: endpointId(r.endpoint) })),
  });
});

function endpointId(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex").slice(0, 16);
}

function safeHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "unknown";
  }
}
