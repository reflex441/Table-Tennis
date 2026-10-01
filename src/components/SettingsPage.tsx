"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, CheckCircle2, Info, Loader2, Send, Smartphone, XCircle } from "lucide-react";
import { useSettings } from "./SettingsProvider";
import { useNotifications } from "./NotificationProvider";
import { ReminderPicker } from "./ReminderPicker";
import { api } from "@/lib/client-api";
import { detectPushState, subscribeToPush, unsubscribeFromPush, type PushState } from "@/lib/push-client";
import { listTimeZones } from "@/lib/format";
import { useBrowserTimeZone } from "./useBrowserTimeZone";
import type { SettingsDTO } from "@/lib/validation/settings";

interface Health {
  database: boolean;
  geminiConfigured: boolean;
  pushConfigured: boolean;
  schedulerMode: string;
  cronConfigured: boolean;
}

interface Device {
  id: string;
  createdAt: string;
  userAgent: string | null;
  active: boolean;
  failureCount: number;
  lastSuccessAt: string | null;
  lastError: string | null;
  endpointHost: string;
}

export function SettingsPage() {
  const { settings, update } = useSettings();
  const { notify } = useNotifications();
  const browserTz = useBrowserTimeZone();
  const [tzDraft, setTzDraft] = useState(settings.timezone);
  const [saving, setSaving] = useState<string | null>(null);
  const [pushState, setPushState] = useState<PushState | "unknown">("unknown");
  const [permission, setPermission] = useState<string>("unknown");
  const [health, setHealth] = useState<Health | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [testing, setTesting] = useState(false);
  const [zones] = useState(() => listTimeZones());

  const refreshDevices = useCallback(async () => {
    const res = await api<{ subscriptions: Device[] }>("/api/push/subscriptions").catch(() => ({ subscriptions: [] }));
    setDevices(res.subscriptions);
  }, []);

  const refreshPush = useCallback(async () => {
    setPushState(await detectPushState());
    setPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [state, h, d] = await Promise.all([
        detectPushState(),
        api<Health>("/api/health").catch(() => null),
        api<{ subscriptions: Device[] }>("/api/push/subscriptions").catch(() => ({ subscriptions: [] as Device[] })),
      ]);
      if (cancelled) return;
      setPushState(state);
      setPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
      setHealth(h);
      setDevices(d.subscriptions);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async (patch: Partial<SettingsDTO>, key: string) => {
    setSaving(key);
    try {
      await update(patch);
    } catch (err) {
      notify("Could not save settings", err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(null);
    }
  };

  const enablePush = async () => {
    try {
      await subscribeToPush();
      notify("Notifications enabled on this device");
    } catch (err) {
      notify("Could not enable notifications", err instanceof Error ? err.message : String(err));
    }
    await refreshPush();
    await refreshDevices();
  };

  const disablePush = async () => {
    await unsubscribeFromPush();
    await refreshPush();
    await refreshDevices();
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const res = await api<{ pushConfigured: boolean; devices: number; sent: number; results: { ok: boolean; error: string | null }[] }>("/api/notifications/test", {
        method: "POST",
      });
      const failed = res.results.filter((r) => !r.ok);
      notify(
        "Test sent",
        !res.pushConfigured
          ? "Push is not configured on the server (VAPID keys missing) - only the in-app notification was sent."
          : `Push delivered to ${res.sent} of ${res.devices} device(s).${failed.length ? ` Errors: ${failed.map((f) => f.error).join("; ")}` : ""}`,
      );
      await refreshDevices();
    } catch (err) {
      notify("Test failed", err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>

      <Section title="Default reminder" description="Used for new matches. Every match can still have its own reminder.">
        <ReminderPicker value={settings.defaultReminderMinutes} onChange={(m) => void save({ defaultReminderMinutes: m }, "reminder")} />
        {saving === "reminder" && <Saving />}
      </Section>

      <Section title="Timezone" description="Screenshot times without an explicit timezone are interpreted in this timezone, and all times are displayed in it.">
        <div className="flex flex-wrap items-center gap-2">
          <input className="input max-w-xs" list="tz-list" value={tzDraft} onChange={(e) => setTzDraft(e.target.value)} aria-label="Timezone" />
          <datalist id="tz-list">
            {zones.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
          <button className="btn-primary" disabled={!zones.includes(tzDraft) && tzDraft !== "UTC"} onClick={() => void save({ timezone: tzDraft, timezoneConfirmed: true }, "tz")}>
            Save
          </button>
          {browserTz && browserTz !== tzDraft && (
            <button
              className="btn-ghost"
              onClick={() => {
                setTzDraft(browserTz);
                void save({ timezone: browserTz, timezoneConfirmed: true }, "tz");
              }}
            >
              Use browser ({browserTz})
            </button>
          )}
          {saving === "tz" && <Saving />}
        </div>
        <p className={`mt-2 flex items-center gap-1 text-xs ${settings.timezoneConfirmed ? "text-over" : "text-warn"}`}>
          {settings.timezoneConfirmed ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Info className="h-3.5 w-3.5" />}
          {settings.timezoneConfirmed ? `Confirmed: ${settings.timezone}` : `Not confirmed yet (currently ${settings.timezone}). Extracted times will require manual confirmation.`}
        </p>
        <div className="mt-3">
          <span className="label">Numeric dates like 03/04/2026 mean</span>
          <div className="flex gap-2">
            {(["DMY", "MDY"] as const).map((o) => (
              <label key={o} className="flex items-center gap-1.5 text-sm">
                <input type="radio" name="dateOrder" checked={settings.dateOrder === o} onChange={() => void save({ dateOrder: o }, "order")} />
                {o === "DMY" ? "Day/Month (3 April)" : "Month/Day (March 4)"}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">Ambiguous dates are always shown for confirmation.</p>
        </div>
      </Section>

      <Section title="Notifications on this device" description="Background notifications use the Web Push API and a service worker.">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {pushState === "subscribed" ? (
            <>
              <span className="flex items-center gap-1 text-over">
                <Bell className="h-4 w-4" /> Subscribed
              </span>
              <button className="btn-ghost ml-auto" onClick={() => void disablePush()}>
                <BellOff className="h-4 w-4" /> Disable on this device
              </button>
            </>
          ) : (
            <>
              <span className="flex items-center gap-1 text-muted">
                <BellOff className="h-4 w-4" />
                {pushState === "denied" && "Blocked in browser settings"}
                {pushState === "unsupported" && "Not supported by this browser"}
                {pushState === "ios-install" && "Add to Home Screen first (iOS)"}
                {pushState === "prompt" && "Not enabled"}
                {pushState === "unknown" && "Checking…"}
              </span>
              {pushState === "prompt" && (
                <button className="btn-primary ml-auto" onClick={() => void enablePush()}>
                  <Bell className="h-4 w-4" /> Enable notifications
                </button>
              )}
            </>
          )}
        </div>
        <p className="mt-1 text-xs text-muted">Browser permission: {permission}</p>

        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn-ghost" disabled={testing} onClick={() => void sendTest()}>
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send test notification
          </button>
        </div>

        {devices.length > 0 && (
          <div className="mt-3">
            <span className="label">Subscribed devices</span>
            <ul className="divide-y divide-line rounded-lg border border-line">
              {devices.map((d) => (
                <li key={d.id} className="flex items-start gap-2 px-2.5 py-2 text-xs">
                  <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{describeAgent(d.userAgent)} · {d.endpointHost}</p>
                    <p className="text-muted">
                      {d.active ? "active" : "inactive (expired)"}
                      {d.lastSuccessAt ? ` · last delivered ${new Date(d.lastSuccessAt).toLocaleString()}` : ""}
                      {d.failureCount ? ` · ${d.failureCount} failure(s)` : ""}
                    </p>
                    {d.lastError && <p className="truncate text-under">{d.lastError}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section title="Notification preferences">
        <Toggle label="Browser push notifications" hint="Send reminders to subscribed devices, even when the app is closed." checked={settings.pushEnabled} onChange={(v) => void save({ pushEnabled: v }, "push")} />
        <Toggle label="In-app notifications" hint="Show reminders in the notification centre and as pop-ups while the app is open." checked={settings.inAppEnabled} onChange={(v) => void save({ inAppEnabled: v }, "inapp")} />
        <Toggle label="Sound in the app" hint="Play a chime when an in-app reminder arrives (the browser may require you to interact with the page first)." checked={settings.soundEnabled} onChange={(v) => void save({ soundEnabled: v }, "sound")} />
        <Toggle label="Include statistics" hint="Show OVER/UNDER, O/U and EDGE in the notification text." checked={settings.includeStatsInNotification} onChange={(v) => void save({ includeStatsInNotification: v }, "stats")} />
      </Section>

      <Section title="Server status">
        {health ? (
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            <Status ok={health.database} label="Database" />
            <Status ok={health.geminiConfigured} label="Gemini API key" />
            <Status ok={health.pushConfigured} label="Web Push (VAPID keys)" />
            <Status ok={health.schedulerMode !== "external" || health.cronConfigured} label={`Scheduler: ${health.schedulerMode}${health.schedulerMode === "external" ? (health.cronConfigured ? " (cron secret set)" : " (CRON_SECRET missing)") : ""}`} />
          </ul>
        ) : (
          <p className="text-sm text-muted">Loading…</p>
        )}
      </Section>

      <Section title="What notifications can and cannot do">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li>These are <b className="text-text">notifications, not phone alarms</b>: they won&apos;t ring continuously, and they respect Do Not Disturb / Focus modes and silent mode.</li>
          <li>Reminders are scheduled on the server, so they fire even when this page is closed — as long as the device has a push subscription and an internet connection.</li>
          <li><b className="text-text">iPhone/iPad</b>: Web Push works only on iOS/iPadOS 16.4+ after adding the app to the Home Screen and enabling notifications from the installed app.</li>
          <li><b className="text-text">Android</b>: Chrome/Firefox/Edge deliver push in the background, but battery-saver or aggressive app optimisation can delay delivery.</li>
          <li><b className="text-text">Desktop</b>: the browser usually has to be running (it can be in the background). macOS needs notifications allowed for the browser in System Settings.</li>
          <li>Pushes expire when the match starts, so a device that was offline won&apos;t get a stale reminder afterwards.</li>
          <li>Push needs HTTPS (localhost is allowed for development). Private/incognito windows usually can&apos;t receive push.</li>
        </ul>
      </Section>

      <form
        action="/api/auth/logout"
        method="post"
        onSubmit={async (e) => {
          e.preventDefault();
          await fetch("/api/auth/logout", { method: "POST" });
          window.location.replace("/login");
        }}
      >
        <button className="text-xs text-muted underline" type="submit">
          Log out (only relevant when APP_PASSWORD is set)
        </button>
      </form>
    </div>
  );
}

function describeAgent(ua: string | null): string {
  if (!ua) return "Unknown browser";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return `${browser}${os ? ` on ${os}` : ""}`;
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="card p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {description && <p className="mb-3 mt-0.5 text-xs text-muted">{description}</p>}
      {!description && <div className="mb-2" />}
      {children}
    </section>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-1.5">
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className={`mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-accent ${checked ? "bg-accent" : "bg-line"}`}>
        <span className={`h-4 w-4 rounded-full bg-white transition-transform ${checked ? "translate-x-4" : ""}`} />
      </span>
      <span>
        <span className="block text-sm">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </label>
  );
}

function Status({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-1.5">
      {ok ? <CheckCircle2 className="h-4 w-4 text-over" /> : <XCircle className="h-4 w-4 text-under" />}
      {label}
    </li>
  );
}

function Saving() {
  return <Loader2 className="ml-2 inline h-4 w-4 animate-spin text-muted" />;
}
