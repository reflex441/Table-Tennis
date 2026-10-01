"use client";

import { useSyncExternalStore } from "react";
import { DateTime } from "luxon";

/** One shared 1-second ticker for every countdown on the page. */
let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!timer) {
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    listeners.delete(cb);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function useNow(): number {
  return useSyncExternalStore(
    subscribe,
    () => now,
    () => 0,
  );
}

/**
 * Today's date (yyyy-MM-dd) in `timezone`; re-renders only when the day
 * changes. Null during server rendering.
 */
export function useToday(timezone: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => DateTime.fromMillis(now).setZone(timezone).toISODate(),
    () => null,
  );
}
