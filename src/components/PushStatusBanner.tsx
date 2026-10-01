"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BellOff, Globe } from "lucide-react";
import { detectPushState, subscribeToPush, type PushState } from "@/lib/push-client";
import { useBrowserTimeZone } from "./useBrowserTimeZone";
import { useSettings } from "./SettingsProvider";
import { useNotifications } from "./NotificationProvider";

/** Prompts for the two things that most often break alarms: timezone and push permission. */
export function PushStatusBanner() {
  const { settings, update } = useSettings();
  const { notify } = useNotifications();
  const [pushState, setPushState] = useState<PushState | "unknown">("unknown");
  const tz = useBrowserTimeZone();

  useEffect(() => {
    let cancelled = false;
    void detectPushState().then((state) => {
      if (!cancelled) setPushState(state);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const showTz = !settings.timezoneConfirmed && tz;
  const showPush = settings.pushEnabled && pushState !== "unknown" && pushState !== "subscribed";
  if (!showTz && !showPush) return null;

  return (
    <div className="flex flex-col gap-2">
      {showTz && (
        <div className="card flex flex-wrap items-center gap-2 border-warn/40 bg-warn/5 px-3 py-2 text-sm">
          <Globe className="h-4 w-4 text-warn" />
          <span className="flex-1">
            Confirm your timezone so screenshot times are interpreted correctly. Your browser reports <b>{tz}</b>.
          </span>
          <button className="btn-primary py-1 text-xs" onClick={() => void update({ timezone: tz!, timezoneConfirmed: true })}>
            Use {tz}
          </button>
          <Link href="/settings" className="btn-ghost py-1 text-xs">
            Choose…
          </Link>
        </div>
      )}
      {showPush && (
        <div className="card flex flex-wrap items-center gap-2 border-accent/30 bg-accent/5 px-3 py-2 text-sm">
          <BellOff className="h-4 w-4 text-accent" />
          <span className="flex-1">
            {pushState === "prompt" && "Background notifications are off on this device."}
            {pushState === "denied" && "Notifications are blocked for this site. Allow them in your browser's site settings."}
            {pushState === "unsupported" && "This browser does not support push notifications. Alarms will only show while the app is open."}
            {pushState === "ios-install" && "On iPhone/iPad, add TT Alarms to your Home Screen (Share → Add to Home Screen) to receive push notifications."}
          </span>
          {pushState === "prompt" && (
            <button
              className="btn-primary py-1 text-xs"
              onClick={async () => {
                try {
                  await subscribeToPush();
                  setPushState("subscribed");
                  notify("Notifications enabled", "This device will receive match reminders.");
                } catch (err) {
                  notify("Could not enable notifications", err instanceof Error ? err.message : String(err));
                  if (Notification.permission === "denied") setPushState("denied");
                }
              }}
            >
              Enable
            </button>
          )}
        </div>
      )}
    </div>
  );
}
