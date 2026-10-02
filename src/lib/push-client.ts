"use client";

import { api } from "@/lib/client-api";

export interface PushSupport {
  serviceWorker: boolean;
  pushManager: boolean;
  notification: boolean;
  /** iOS/iPadOS Safari only supports push for apps added to the home screen. */
  iosNeedsInstall: boolean;
  secureContext: boolean;
}

export function detectPushSupport(): PushSupport {
  if (typeof window === "undefined") {
    return { serviceWorker: false, pushManager: false, notification: false, iosNeedsInstall: false, secureContext: false };
  }
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  return {
    serviceWorker: "serviceWorker" in navigator,
    pushManager: "PushManager" in window,
    notification: "Notification" in window,
    iosNeedsInstall: isIOS && !standalone,
    secureContext: window.isSecureContext,
  };
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  } catch (err) {
    console.warn("Service worker registration failed", err);
    return null;
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Ask permission, subscribe this browser and store the subscription on the server. */
export async function subscribeToPush(): Promise<PushSubscription> {
  const config = await api<{ configured: boolean; publicKey: string | null; problem?: string | null }>("/api/push/config");
  if (!config.configured || !config.publicKey) {
    throw new Error(config.problem || "Push notifications are not configured on the server (VAPID keys missing).");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(permission === "denied" ? "Notifications are blocked. Allow them in your browser's site settings." : "Notification permission was not granted.");
  }
  const reg = (await registerServiceWorker()) ?? (await navigator.serviceWorker.ready);
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  const key = urlBase64ToUint8Array(config.publicKey);
  if (sub) {
    // Re-subscribe if the server key changed.
    const existingKey = sub.options.applicationServerKey;
    if (existingKey && !sameKey(new Uint8Array(existingKey), key)) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await api("/api/push/subscriptions", { method: "POST", json: { ...sub.toJSON(), deviceType: detectDeviceType() } });
  return sub;
}

export async function unsubscribeFromPush(): Promise<void> {
  const sub = await getCurrentSubscription();
  if (!sub) return;
  await api("/api/push/subscriptions", { method: "DELETE", json: { endpoint: sub.endpoint } }).catch(() => {});
  await sub.unsubscribe();
}

function sameKey(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export type PushState = "subscribed" | "prompt" | "denied" | "unsupported" | "ios-install";

/** Summarise this browser's push capability and subscription state. */
export async function detectPushState(): Promise<PushState> {
  const support = detectPushSupport();
  if (support.iosNeedsInstall) return "ios-install";
  if (!support.serviceWorker || !support.pushManager || !support.notification) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const sub = await getCurrentSubscription().catch(() => null);
  return sub && Notification.permission === "granted" ? "subscribed" : "prompt";
}

/**
 * Phones get one normal notification; computers ring until the bet is
 * confirmed. iPads report a Mac user agent, so touch support is checked too.
 */
export function detectDeviceType(): "desktop" | "mobile" {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return "mobile";
  if (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) return "mobile";
  const uaData = (navigator as unknown as { userAgentData?: { mobile?: boolean } }).userAgentData;
  return uaData?.mobile ? "mobile" : "desktop";
}
