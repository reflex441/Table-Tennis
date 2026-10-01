"use client";

import { unsubscribeFromPush } from "@/lib/push-client";

/**
 * Sign out of this browser. The browser's push subscription is removed first
 * so the next person to use it doesn't get this account's alarms.
 */
export async function signOut(): Promise<void> {
  await unsubscribeFromPush().catch(() => {});
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  window.location.replace("/login");
}
