import webpush, { WebPushError } from "web-push";
import type { PushResult, PushSender } from "@/lib/alarms/dispatcher";
import { env } from "@/lib/env";

let configured = false;

/** Returns a Web Push sender, or null when VAPID keys are not configured. */
export function createWebPushSender(): PushSender | null {
  const e = env();
  if (!e.VAPID_PUBLIC_KEY || !e.VAPID_PRIVATE_KEY) return null;
  if (!configured) {
    webpush.setVapidDetails(e.VAPID_SUBJECT, e.VAPID_PUBLIC_KEY, e.VAPID_PRIVATE_KEY);
    configured = true;
  }
  return {
    async send(sub, payload, ttlSeconds): Promise<PushResult> {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
          { TTL: ttlSeconds, urgency: "high", topic: payload.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32), timeout: 15_000 },
        );
        return { ok: true };
      } catch (err) {
        return classifyPushError(err);
      }
    },
  };
}

/** 404/410: subscription expired. 400/403/413: request will never succeed. */
export function classifyPushError(err: unknown): PushResult {
  if (err instanceof WebPushError) {
    const permanent = [400, 403, 404, 410, 413].includes(err.statusCode);
    return { ok: false, permanent, statusCode: err.statusCode, error: err.body?.slice(0, 300) || err.message };
  }
  return { ok: false, permanent: false, error: err instanceof Error ? err.message : String(err) };
}
