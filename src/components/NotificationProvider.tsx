"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { BellRing, X } from "lucide-react";
import type { InAppNotificationDTO } from "@/lib/types";
import { api } from "@/lib/client-api";
import { detectDeviceType, getCurrentSubscription, registerServiceWorker } from "@/lib/push-client";
import { useSettings } from "./SettingsProvider";
import { installAudioUnlock, playOnce } from "@/lib/siren";

interface Toast {
  id: string;
  title: string;
  body: string;
  url: string;
}

interface NotificationContextValue {
  notifications: InAppNotificationDTO[];
  unread: number;
  refresh: () => Promise<void>;
  markAllRead: () => Promise<void>;
  /** Delete one notification. */
  remove: (id: string) => Promise<void>;
  /** Delete all notifications. */
  clearAll: () => Promise<void>;
  /** Show a transient message (e.g. "Alarm created"). */
  notify: (title: string, body?: string, url?: string) => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export const NOTIFICATION_EVENT = "tt:notification";
const POLL_MS = 15_000;


export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  const [notifications, setNotifications] = useState<InAppNotificationDTO[]>([]);
  const [unread, setUnread] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const cursor = useRef<string | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const soundRef = useRef(settings.soundEnabled);
  const volumeRef = useRef(settings.alarmVolume);
  const alarmSoundRef = useRef(settings.alarmSound);
  useEffect(() => {
    soundRef.current = settings.soundEnabled;
    volumeRef.current = settings.alarmVolume;
    alarmSoundRef.current = settings.alarmSound;
    installAudioUnlock();
  }, [settings.soundEnabled, settings.alarmVolume, settings.alarmSound]);

  const pushToast = useCallback((t: Toast) => {
    setToasts((prev) => [t, ...prev.filter((p) => p.id !== t.id)].slice(0, 4));
    setTimeout(() => setToasts((prev) => prev.filter((p) => p.id !== t.id)), 12_000);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await api<{ notifications: InAppNotificationDTO[]; unread: number; serverTime: string }>("/api/notifications");
      setNotifications(res.notifications);
      setUnread(res.unread);
      const first = cursor.current === null;
      const fresh = res.notifications.filter((n) => !seen.current.has(n.id) && (first ? false : !cursor.current || n.createdAt > cursor.current));
      res.notifications.forEach((n) => seen.current.add(n.id));
      if (first) {
        cursor.current = res.serverTime;
      } else if (res.notifications[0] && res.notifications[0].createdAt > (cursor.current ?? "")) {
        cursor.current = res.notifications[0].createdAt;
      }
      if (fresh.length) {
        fresh.forEach((n) => pushToast({ id: n.id, title: n.title, body: n.body, url: n.url }));
        if (soundRef.current) playOnce(volumeRef.current, alarmSoundRef.current);
        window.dispatchEvent(new CustomEvent(NOTIFICATION_EVENT));
      }
    } catch {
      /* offline or not authorised - try again later */
    }
  }, [pushToast]);

  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  // Register the service worker and keep the server's copy of this browser's
  // push subscription in sync (e.g. after the database was reset).
  useEffect(() => {
    void (async () => {
      await registerServiceWorker();
      const sub = await getCurrentSubscription().catch(() => null);
      if (sub && Notification.permission === "granted") {
        await api("/api/push/subscriptions", { method: "POST", json: { ...sub.toJSON(), deviceType: detectDeviceType() } }).catch(() => {});
      }
    })();
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "push-received") void refresh();
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
  }, [refresh]);

  const markAllRead = useCallback(async () => {
    await api("/api/notifications/read", { method: "POST", json: { all: true } }).catch(() => {});
    setUnread(0);
    setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
  }, []);

  const remove = useCallback(async (id: string) => {
    setNotifications((prev) => {
      const gone = prev.find((n) => n.id === id);
      if (gone && !gone.readAt) setUnread((u) => Math.max(0, u - 1));
      return prev.filter((n) => n.id !== id);
    });
    await api(`/api/notifications/${id}`, { method: "DELETE" }).catch(() => {});
  }, []);

  const clearAll = useCallback(async () => {
    setNotifications([]);
    setUnread(0);
    await api("/api/notifications", { method: "DELETE" }).catch(() => {});
  }, []);

  const notify = useCallback(
    (title: string, body = "", url = "") => pushToast({ id: `local-${Date.now()}-${Math.random()}`, title, body, url }),
    [pushToast],
  );

  const value = useMemo(
    () => ({ notifications, unread, refresh, markAllRead, remove, clearAll, notify }),
    [notifications, unread, refresh, markAllRead, remove, clearAll, notify],
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-14 z-50 flex flex-col items-center gap-2 px-3 sm:items-end sm:pr-4" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="card pointer-events-auto w-full max-w-sm border-accent/40 bg-panel-2 p-3 shadow-2xl shadow-black/50">
            <div className="flex items-start gap-2">
              <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{t.title}</p>
                {t.body && <p className="mt-0.5 whitespace-pre-line text-xs text-muted">{t.body}</p>}
                {t.url && (
                  <Link href={t.url} className="mt-1 inline-block text-xs font-medium text-accent hover:underline">
                    Open
                  </Link>
                )}
              </div>
              <button aria-label="Dismiss" className="text-muted hover:text-text" onClick={() => setToasts((p) => p.filter((x) => x.id !== t.id))}>
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </NotificationContext.Provider>
  );
}

export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotifications must be used inside NotificationProvider");
  return ctx;
}
