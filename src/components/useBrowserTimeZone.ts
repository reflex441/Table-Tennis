"use client";

import { useSyncExternalStore } from "react";
import { browserTimeZone } from "@/lib/format";

const noop = () => () => {};

/** The browser's IANA timezone, or null during server rendering. */
export function useBrowserTimeZone(): string | null {
  return useSyncExternalStore(noop, browserTimeZone, () => null);
}
