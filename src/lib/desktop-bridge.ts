import { useSyncExternalStore } from "react";

/**
 * Bridge exposed by the Windows desktop app (desktop/preload.js) as
 * `window.ttDesktop`. Inside it, Web Push isn't available, so notifications
 * and alarms are shown as native Windows notifications through this bridge.
 * In a normal browser it is absent and everything works as before.
 */
export interface DesktopBridge {
  /** A native notification; clicking it opens `url` in the app. */
  notify(n: { title: string; body: string; url?: string | null }): void;
  /** An alarm: native notification and the app window brought to the front. */
  alarm(n: { title: string; body: string; url?: string | null }): void;
}

export function desktopApp(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { ttDesktop?: DesktopBridge }).ttDesktop ?? null;
}

const noopSubscribe = () => () => {};

/** True inside the desktop app (false during server rendering). */
export function useIsDesktopApp(): boolean {
  return useSyncExternalStore(noopSubscribe, () => desktopApp() !== null, () => false);
}
