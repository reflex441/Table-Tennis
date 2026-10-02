"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, BellOff, CheckCircle2, Eye, EyeOff, Info, KeyRound, Loader2, Send, Smartphone, Volume2, XCircle } from "lucide-react";
import { startSiren, unlockAudio } from "@/lib/siren";
import { ALARM_SOUNDS, ALARM_SOUND_LABEL } from "@/lib/alarm-sounds";
import { useSettings } from "./SettingsProvider";
import { useNotifications } from "./NotificationProvider";
import { ReminderPicker } from "./ReminderPicker";
import { api } from "@/lib/client-api";
import { detectPushState, subscribeToPush, unsubscribeFromPush, type PushState } from "@/lib/push-client";
import { formatMoney, formatUnits } from "@/lib/bets/profit";
import { SUGGESTED_LEAGUES, isSafeUrl, normalizeLeague, type LeagueLink } from "@/lib/leagues";
import { signOut } from "@/lib/sign-out";
import type { PublicUser } from "@/lib/auth/accounts";
import { Avatar } from "./Avatar";
import { TUTORIAL_EVENT } from "./Onboarding";
import type { SettingsUpdate } from "@/lib/validation/settings";
import { useIsDesktopApp } from "@/lib/desktop-bridge";

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
  deviceType: "desktop" | "mobile";
  active: boolean;
  failureCount: number;
  lastSuccessAt: string | null;
  lastError: string | null;
  endpointHost: string;
}

export function SettingsPage() {
  const { settings, update } = useSettings();
  const { notify } = useNotifications();
  const [saving, setSaving] = useState<string | null>(null);
  const [pushState, setPushState] = useState<PushState | "unknown">("unknown");
  const isDesktopApp = useIsDesktopApp();
  const [permission, setPermission] = useState<string>("unknown");
  const [health, setHealth] = useState<Health | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [testing, setTesting] = useState(false);

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

  const save = async (patch: SettingsUpdate, key: string) => {
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

      <GeminiKeySection />

      <Section title="Notifications on this device" description="Background notifications use the Web Push API and a service worker.">
        {isDesktopApp ? (
          <p className="flex items-center gap-1 text-sm text-over">
            <Bell className="h-4 w-4" /> Built in: the desktop app shows Windows notifications and rings alarms while it&apos;s running (also from the tray).
          </p>
        ) : (
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
        )}
        {!isDesktopApp && <p className="mt-1 text-xs text-muted">Browser permission: {permission}</p>}

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
                  <button
                    className="btn-ghost shrink-0 px-2 py-1 text-[11px]"
                    title="Computers ring until you confirm the bet; phones get one normal notification"
                    onClick={async () => {
                      const next = d.deviceType === "mobile" ? "desktop" : "mobile";
                      await api(`/api/push/subscriptions/${d.id}`, { method: "PATCH", json: { deviceType: next } }).catch(() => {});
                      await refreshDevices();
                    }}
                  >
                    {d.deviceType === "mobile" ? "📱 Phone" : "💻 Computer"}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section title="Default reminder" description="Used for new matches. Every match can still have its own reminder.">
        <ReminderPicker value={settings.defaultReminderMinutes} onChange={(m) => void save({ defaultReminderMinutes: m }, "reminder")} />
        {saving === "reminder" && <Saving />}
      </Section>

      <AlarmSection />

      <Section title="Notification preferences">
        <Toggle label="Browser push notifications" hint="Send reminders to subscribed devices, even when the app is closed." checked={settings.pushEnabled} onChange={(v) => void save({ pushEnabled: v }, "push")} />
        <Toggle label="In-app notifications" hint="Show reminders in the notification centre and as pop-ups while the app is open." checked={settings.inAppEnabled} onChange={(v) => void save({ inAppEnabled: v }, "inapp")} />
        <Toggle label="Alarm sound" hint="Siren on computers until you confirm the bet (phones never play it)." checked={settings.soundEnabled} onChange={(v) => void save({ soundEnabled: v }, "sound")} />
        <Toggle label="Include statistics" hint="Show the pick (OVER / UNDER / SWEEP), O/U and EDGE in the notification text." checked={settings.includeStatsInNotification} onChange={(v) => void save({ includeStatsInNotification: v }, "stats")} />
      </Section>

      <LeagueLinksSection />

      <UnitsSection />

      <AverageOddsSection />

      <AccountSection />

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

/** Enter, test and remove the Gemini API key. The saved key is never sent back to the browser. */
function GeminiKeySection() {
  const { settings, update } = useSettings();
  const [draft, setDraft] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState<"save" | "test" | "remove" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [available, setAvailable] = useState<string[]>([]);

  const test = async (apiKey?: string) => {
    setBusy("test");
    setResult(null);
    try {
      const res = await api<{ ok: true; model: string; available: string[] } | { ok: false; message: string; available?: string[] }>("/api/settings/gemini-test", {
        method: "POST",
        json: apiKey ? { apiKey } : {},
      });
      setResult(res.ok ? { ok: true, text: `Key works (${res.model}).` } : { ok: false, text: res.message });
      setAvailable(res.available ?? []);
      return res.ok;
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : String(err) });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const saveKey = async () => {
    setBusy("save");
    setResult(null);
    try {
      await update({ geminiApiKey: draft.trim() });
      setDraft("");
      setShow(false);
      setResult({ ok: true, text: "Key saved." });
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  };

  const removeKey = async () => {
    if (!window.confirm("Remove the saved Gemini API key?")) return;
    setBusy("remove");
    setResult(null);
    try {
      await update({ geminiApiKey: null });
      setResult({ ok: true, text: "Key removed." });
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  };

  const source = settings.geminiKeySource;
  return (
    <Section title="Gemini API" description="Used to read your screenshots. Get a free key at aistudio.google.com/apikey.">
      <p className={`mb-3 flex items-center gap-1.5 text-sm ${source === "none" ? "text-warn" : "text-over"}`}>
        {source === "none" ? <Info className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
        {source === "settings" && <>Key saved ({settings.geminiKeyHint})</>}
        {source === "none" && <>No key yet — scanning won&apos;t work until you add one</>}
      </p>

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) void saveKey();
        }}
      >
        <div className="relative min-w-[16rem] flex-1">
          <KeyRound className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type={show ? "text" : "password"}
            className="input pl-8 pr-9 font-mono"
            placeholder={source === "settings" ? "Paste a new key to replace it" : "Paste your API key (starts with AIza…)"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-label="Gemini API key"
          />
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? "Hide key" : "Show key"}
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <button type="button" className="btn-ghost" disabled={!draft.trim() || busy !== null} onClick={() => void test(draft.trim())}>
          {busy === "test" && draft ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Test
        </button>
        <button type="submit" className="btn-primary" disabled={!draft.trim() || busy !== null}>
          {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
        </button>
      </form>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {source !== "none" && !draft && (
          <button type="button" className="btn-ghost py-1 text-xs" disabled={busy !== null} onClick={() => void test()}>
            {busy === "test" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Test current key
          </button>
        )}
        {source === "settings" && (
          <button type="button" className="btn-danger py-1 text-xs" disabled={busy !== null} onClick={() => void removeKey()}>
            Remove saved key
          </button>
        )}
        {result && <span className={`text-xs ${result.ok ? "text-over" : "text-under"}`}>{result.text}</span>}
      </div>
      <ModelFields available={available} />

      <p className="mt-2 text-xs text-muted">
        Each account uses its own key. It is stored on the server, only used for your scans, and never shown again after saving.
      </p>
    </Section>
  );
}

/** Computer alarm: ring until the bet is confirmed. */
function AlarmSection() {
  const { settings, update } = useSettings();
  const [testing, setTesting] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [volume, setVolume] = useState(settings.alarmVolume);

  // Save the volume shortly after the slider stops moving.
  useEffect(() => {
    if (volume === settings.alarmVolume) return;
    const t = setTimeout(() => void update({ alarmVolume: volume }), 400);
    return () => clearTimeout(t);
  }, [volume, settings.alarmVolume, update]);

  const testAlarm = async () => {
    const ok = await unlockAudio();
    setBlocked(!ok);
    if (!ok) return;
    setTesting(true);
    const stop = startSiren(volume, settings.alarmSound);
    setTimeout(() => {
      stop();
      setTesting(false);
    }, 3000);
  };

  return (
    <Section
      title="Alarm on computers"
      description="On a computer, a reminder shows a full-screen alert and keeps ringing until you click &quot;I've placed the bet&quot;. Phones only get one normal notification."
    >
      <Toggle
        label="Ring until I confirm the bet"
        hint="Full-screen alert + continuous siren in the TT Alarms tab, and the computer's notification stays on screen with Bet placed / Skip buttons."
        checked={settings.ringUntilAck}
        onChange={(v) => void update({ ringUntilAck: v })}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">Repeat the notification every</span>
        {[15, 30, 60].map((sec) => (
          <button
            key={sec}
            type="button"
            onClick={() => void update({ repeatSeconds: sec })}
            className={`rounded-md border px-2 py-1 text-xs ${settings.repeatSeconds === sec ? "border-accent bg-accent/15 text-accent" : "border-line bg-bg text-muted hover:text-text"}`}
          >
            {sec}s
          </button>
        ))}
        <span className="text-xs text-muted">(computers only, until you confirm or the match starts)</span>
      </div>
      <label className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted">Alarm volume</span>
        <input
          type="range"
          min={1}
          max={100}
          step={1}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          className="w-48 accent-[var(--color-accent)]"
          aria-label="Alarm volume"
          aria-valuetext={`${volume}%`}
        />
        <span className="w-10 tabular text-xs text-muted">{volume}%</span>
      </label>
      <div className="mt-3">
        <span className="label">Alarm sound</span>
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Alarm sound">
          {ALARM_SOUNDS.map((snd) => (
            <button
              key={snd}
              type="button"
              role="radio"
              aria-checked={settings.alarmSound === snd}
              onClick={() => {
                void update({ alarmSound: snd });
                // Short preview of the sound.
                void unlockAudio().then((ok) => {
                  if (!ok) return setBlocked(true);
                  const stop = startSiren(volume, snd);
                  setTimeout(stop, 1600);
                });
              }}
              className={`rounded-lg border px-3 py-1.5 text-left text-xs ${
                settings.alarmSound === snd ? "border-accent bg-accent/15 text-accent" : "border-line bg-bg text-muted hover:text-text"
              }`}
            >
              <span className="block font-semibold">{ALARM_SOUND_LABEL[snd].label}</span>
              <span className="block text-[11px] opacity-80">{ALARM_SOUND_LABEL[snd].hint}</span>
            </button>
          ))}
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">The volume and sound also apply to the in-app notification chime. Your computer&apos;s own volume still applies.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className="btn-ghost" disabled={testing} onClick={() => void testAlarm()}>
          <Volume2 className="h-4 w-4" /> {testing ? "Ringing…" : "Test alarm sound"}
        </button>
        {blocked && <span className="text-xs text-warn">The browser blocked sound - click the button again.</span>}
      </div>
      <p className="mt-2 text-xs text-muted">
        Windows: if pop-ups don&apos;t appear, turn off &quot;Do not disturb&quot; (bell icon at the bottom right of the taskbar) or add your browser under Settings → System → Notifications → Set priority notifications. Keep a TT Alarms tab open on your computer (it can be in the background) - the siren plays from that tab. Websites can&apos;t play a continuous sound when the browser is closed; then you&apos;ll still get the repeating notification.
      </p>
    </Section>
  );
}

/** What one betting unit is worth; the Profit page shows units with this money amount next to them. */
function UnitsSection() {
  const { settings, update } = useSettings();
  const [size, setSize] = useState(String(settings.unitSize));
  const [currency, setCurrency] = useState(settings.currency);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const n = Number(size.replace(/[^\d.]/g, ""));
    if (!Number.isFinite(n) || n <= 0) return setError("Enter how much 1 unit is worth, e.g. 10.");
    if (!currency.trim()) return setError("Enter a currency symbol, e.g. $.");
    setBusy(true);
    setError(null);
    try {
      const s = await update({ unitSize: Math.round(n * 100) / 100, currency: currency.trim() });
      setSize(String(s.unitSize));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div id="units" className="scroll-mt-16">
      <Section title="Units" description="Profit is tracked in units. Set what 1 unit is worth - the Profit page shows the money amount next to every unit figure.">
        <div className="flex flex-wrap items-end gap-2">
          <span className="pb-1.5 text-sm">1 unit =</span>
          <label className="w-16">
            <span className="label">Currency</span>
            <input className="input" value={currency} maxLength={4} onChange={(e) => setCurrency(e.target.value)} aria-label="Currency symbol" />
          </label>
          <label className="w-28">
            <span className="label">Amount</span>
            <input
              className="input tabular"
              inputMode="decimal"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void save()}
              aria-label="Value of one unit"
            />
          </label>
          <button className="btn-primary" disabled={busy} onClick={() => void save()}>
            {saved ? "Saved" : "Save"}
          </button>
        </div>
        {error && <p className="mt-1 text-xs text-under">{error}</p>}
        <p className="mt-2 text-xs text-muted">
          Example: a +2.5u day = {settings.currency}
          {(2.5 * settings.unitSize).toFixed(2)}. Bot plays default to the stake on the pick badge (&quot;1U OVER&quot; = 1 unit); personal plays default to 1 unit.
        </p>
      </Section>
    </div>
  );
}

/** Price every bet at one average odds value instead of each bet's own odds. */
function AverageOddsSection() {
  const { settings, update } = useSettings();
  const [draft, setDraft] = useState(String(settings.averageOdds));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = async (patch: SettingsUpdate) => {
    setBusy(true);
    setError(null);
    try {
      const s = await update(patch);
      setDraft(String(s.averageOdds));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const saveOdds = () => {
    const n = Number(draft.replace(",", "."));
    if (!Number.isFinite(n) || n <= 1) return setError("Enter decimal odds above 1.00, e.g. 1.85.");
    void save({ averageOdds: Math.round(n * 100) / 100 });
  };

  return (
    <Section
      title="Average odds"
      description="Every new match you upload starts with a 1u stake. When this is ticked it also gets these odds, which you can change on the review screen before creating the alarms. Changing this setting never changes matches or bets you already have."
    >
      <Toggle
        label="Use average odds for bets without odds"
        hint={
          settings.useAverageOdds
            ? `New uploads get odds ${settings.averageOdds.toFixed(2)} and 1u.`
            : "New uploads get 1u and no odds - add the odds yourself."
        }
        checked={settings.useAverageOdds}
        onChange={(v) => void save({ useAverageOdds: v })}
      />
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="w-28">
          <span className="label">Average odds</span>
          <input
            className="input tabular"
            inputMode="decimal"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveOdds()}
            aria-label="Average decimal odds"
          />
        </label>
        <button className="btn-primary" disabled={busy} onClick={saveOdds}>
          {saved ? "Saved" : "Save"}
        </button>
        {busy && <Saving />}
      </div>
      {error && <p className="mt-1 text-xs text-under">{error}</p>}
      <p className="mt-2 text-xs text-muted">
        Example: a 1u win at {settings.averageOdds.toFixed(2)} = {formatUnits(settings.averageOdds - 1)} (
        {formatMoney(settings.averageOdds - 1, settings.unitSize, settings.currency)}).
      </p>
    </Section>
  );
}

/** Main and backup Gemini models, saved on the server. */
function ModelFields({ available }: { available: string[] }) {
  const { settings, update } = useSettings();
  const [model, setModel] = useState(settings.geminiModel);
  const [backup, setBackup] = useState(settings.geminiFallbackModel);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = model.trim() !== settings.geminiModel || backup.trim() !== settings.geminiFallbackModel;

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const s = await update({ geminiModel: model, geminiFallbackModel: backup });
      setModel(s.geminiModel);
      setBackup(s.geminiFallbackModel);
      setMsg({ ok: true, text: "Models saved." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 flex flex-col gap-3">
      <label>
        <span className="label">Model</span>
        <input className="input font-mono" value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} aria-label="Gemini model" />
        <span className="mt-1 block text-xs text-muted">Use a Flash model, e.g. gemini-3.5-flash-lite or gemini-3.5-flash. Flash models are on the free tier.</span>
      </label>
      <label>
        <span className="label">Backup model</span>
        <input className="input font-mono" value={backup} onChange={(e) => setBackup(e.target.value)} spellCheck={false} aria-label="Backup Gemini model" />
        <span className="mt-1 block text-xs text-muted">
          Used automatically when the main model is busy or out of requests. Leave empty to turn off. Test connection lists the model names your key can use.
        </span>
      </label>
      {available.length > 0 && (
        <div>
          <span className="label">Models your key can use (click to use as the main model)</span>
          <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto">
            {available.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setModel(m)}
                className={`rounded-md border px-2 py-0.5 font-mono text-[11px] ${m === model.trim() ? "border-accent bg-accent/15 text-accent" : "border-line bg-bg text-muted hover:text-text"}`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-center gap-2">
        <button type="button" className="btn-primary" disabled={!dirty || busy} onClick={() => void save()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save models
        </button>
        {msg && <span className={`text-xs ${msg.ok ? "text-over" : "text-under"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}

/** Who is signed in, leaderboard visibility and sign out. */
function AccountSection() {
  const { settings, update } = useSettings();
  const router = useRouter();
  const [user, setUser] = useState<PublicUser | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void api<{ user: PublicUser | null }>("/api/auth/me")
      .then((r) => {
        if (cancelled || !r.user) return;
        setUser(r.user);
        setName(r.user.name);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const [picBusy, setPicBusy] = useState(false);
  const uploadPicture = async (file: File) => {
    setPicBusy(true);
    setMsg(null);
    try {
      const blob = await squareThumbnail(file, 256);
      const form = new FormData();
      form.append("file", new File([blob], "avatar.jpg", { type: "image/jpeg" }));
      const res = await fetch("/api/auth/me/avatar", { method: "POST", body: form });
      const body = (await res.json().catch(() => null)) as { user?: PublicUser; error?: { message?: string } } | null;
      if (!res.ok || !body?.user) throw new Error(body?.error?.message ?? "Upload failed.");
      setUser(body.user);
      setMsg({ ok: true, text: "Profile picture saved." });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Couldn't use that picture." });
    } finally {
      setPicBusy(false);
    }
  };
  const removePicture = async () => {
    setPicBusy(true);
    try {
      const res = await api<{ user: PublicUser }>("/api/auth/me/avatar", { method: "DELETE" });
      setUser(res.user);
      router.refresh();
    } finally {
      setPicBusy(false);
    }
  };

  const saveName = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api<{ user: PublicUser }>("/api/auth/me", { method: "PATCH", json: { name } });
      setUser(res.user);
      setName(res.user.name);
      setMsg({ ok: true, text: "Display name saved." });
      router.refresh(); // update the name in the account menu
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Account">
      {user && (
        <div className="flex flex-wrap items-center gap-3">
          <Avatar name={user.name} url={user.avatarUrl} size={56} />
          <div className="min-w-0 flex-1">
            <p className="text-sm">
              Signed in as <b>{user.name}</b> <span className="text-muted">({user.email})</span>
              {user.hasGoogle && <span className="ml-2 chip bg-line text-muted">Google</span>}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <label className="btn-ghost cursor-pointer py-1 text-xs">
                {picBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} {user.avatarUrl ? "Change picture" : "Add profile picture"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
                  className="sr-only"
                  aria-label="Profile picture"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void uploadPicture(f);
                  }}
                />
              </label>
              {user.avatarUrl && (
                <button type="button" className="btn-ghost py-1 text-xs" disabled={picBusy} onClick={() => void removePicture()}>
                  Remove picture
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {user && (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void saveName();
          }}
        >
          <label className="min-w-[12rem] flex-1">
            <span className="label">Display name</span>
            <input className="input" aria-label="Display name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          </label>
          <button type="submit" className="btn-primary" disabled={busy || !name.trim() || name.trim() === user.name}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
          </button>
          {msg && <span className={`w-full text-xs ${msg.ok ? "text-over" : "text-under"}`}>{msg.text}</span>}
        </form>
      )}
      <p className="mt-1 text-xs text-muted">Shown in the app and on the leaderboard. Your email is never shown to others.</p>
      <Toggle
        label="Show me on the leaderboard"
        hint="Only your display name and your results are shown - never your email."
        checked={settings.showOnLeaderboard}
        onChange={(v) => void update({ showOnLeaderboard: v })}
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <button className="btn-ghost" onClick={() => window.dispatchEvent(new Event(TUTORIAL_EVENT))}>
          Show the tutorial again
        </button>
        <button className="btn-ghost" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
      <p className="mt-1 text-xs text-muted">Signing out also stops this browser getting your alarm notifications.</p>
    </Section>
  );
}

/** Bookmaker page per league; the player names on a match open it. */
function LeagueLinksSection() {
  const { settings, update } = useSettings();
  const initialRows = (): LeagueLink[] => {
    const saved = settings.leagueLinks;
    const have = new Set(saved.map((l) => normalizeLeague(l.league)));
    return [...saved, ...SUGGESTED_LEAGUES.filter((l) => !have.has(normalizeLeague(l))).map((league) => ({ league, url: "" }))];
  };
  const [rows, setRows] = useState<LeagueLink[]>(initialRows);
  const [competitions, setCompetitions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // League names from your matches, offered as suggestions.
  useEffect(() => {
    let cancelled = false;
    void api<{ matches: { competition: string | null }[] }>("/api/matches")
      .then((r) => {
        if (cancelled) return;
        const seen = new Map<string, string>();
        for (const m of r.matches) if (m.competition) seen.set(normalizeLeague(m.competition), m.competition);
        setCompetitions([...seen.values()].sort());
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const setRow = (i: number, patch: Partial<LeagueLink>) => setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  const filled = rows.map((r) => ({ league: r.league.trim(), url: r.url.trim() })).filter((r) => r.league && r.url);
  const invalid = filled.find((r) => !isSafeUrl(r.url));

  const save = async () => {
    if (invalid) return setMsg({ ok: false, text: `The link for ${invalid.league} must be a full web address starting with https://` });
    setBusy(true);
    setMsg(null);
    try {
      await update({ leagueLinks: filled });
      setMsg({ ok: true, text: "League links saved." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="League links"
      description="Paste the Ladbrokes / Sportsbet table tennis page for each league. Clicking the player names on a match (or on the alarm) opens that league's page in a new tab."
    >
      <datalist id="league-names">
        {[...new Set([...SUGGESTED_LEAGUES, ...competitions])].map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <div className="flex flex-col gap-2">
        {rows.map((row, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
            <input
              className="input sm:w-44"
              list="league-names"
              placeholder="League, e.g. TT Cup"
              value={row.league}
              onChange={(e) => setRow(i, { league: e.target.value })}
              aria-label={`League ${i + 1} name`}
            />
            <input
              className="input min-w-0 flex-1 font-mono text-xs"
              inputMode="url"
              placeholder="https://www.ladbrokes.com.au/sports/table-tennis/..."
              value={row.url}
              onChange={(e) => setRow(i, { url: e.target.value })}
              aria-label={`${row.league || `League ${i + 1}`} link`}
            />
            <button type="button" className="btn-ghost px-2" onClick={() => setRows((r) => r.filter((_, j) => j !== i))} aria-label={`Remove ${row.league || "league"}`}>
              <XCircle className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-ghost" onClick={() => setRows((r) => [...r, { league: "", url: "" }])}>
          + Add league
        </button>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void save()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save links
        </button>
        {msg && <span className={`text-xs ${msg.ok ? "text-over" : "text-under"}`}>{msg.text}</span>}
      </div>
      <p className="mt-2 text-xs text-muted">
        League names are matched ignoring capitals and spaces, so &quot;TT Cup&quot; also matches &quot;TT CUP&quot;. Leagues without a link open the match details instead.
      </p>
    </Section>
  );
}

/** Centre-crop and resize a picture to a small square JPEG in the browser. */
async function squareThumbnail(file: File, size: number): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("This picture can't be read by the browser. Try a JPEG or PNG."));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Couldn't process the picture.");
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't process the picture."))), "image/jpeg", 0.85));
  } finally {
    URL.revokeObjectURL(url);
  }
}
