"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Bell, BellRing, Check, CheckCircle2, ExternalLink, ImagePlus, KeyRound, Loader2, TrendingUp, Trophy, Upload, Users, X } from "lucide-react";
import type { PublicUser } from "@/lib/auth/accounts";
import { api } from "@/lib/client-api";
import { detectPushState, subscribeToPush, type PushState } from "@/lib/push-client";
import { useIsDesktopApp } from "@/lib/desktop-bridge";
import { useSettings } from "./SettingsProvider";
import { BOOKMAKER_LINKS, withBookmakerLinks, type Bookmaker } from "@/lib/leagues";

/** Dispatch on window to open the tutorial again (Settings → Account). */
export const TUTORIAL_EVENT = "tt:tutorial";

type Source = "cage" | "tail";
type Step = "welcome" | "source" | "gemini" | "bookmaker" | "notifications" | "units" | "how" | "done";

/**
 * First-run tutorial, shown once per account after signing up: where picks
 * come from (Cage Capital screenshots, or Tailing), the Gemini key,
 * notifications, unit size, and how alarms and profit tracking work.
 */
export function Onboarding({ user }: { user: PublicUser }) {
  const [open, setOpen] = useState(!user.onboarded);
  const [step, setStep] = useState<Step>("welcome");
  const [source, setSource] = useState<Source | null>(null);

  useEffect(() => {
    const show = () => {
      setStep("welcome");
      setOpen(true);
    };
    window.addEventListener(TUTORIAL_EVENT, show);
    return () => window.removeEventListener(TUTORIAL_EVENT, show);
  }, []);

  const steps: Step[] = ["welcome", "source", ...(source === "tail" ? [] : (["gemini"] as Step[])), "bookmaker", "notifications", "units", "how", "done"];
  const index = steps.indexOf(step);
  const next = () => setStep(steps[Math.min(index + 1, steps.length - 1)]);
  const back = () => setStep(steps[Math.max(index - 1, 0)]);

  const finish = () => {
    setOpen(false);
    void api("/api/auth/me/onboarding", { method: "POST", json: { done: true } }).catch(() => {});
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center overflow-y-auto bg-black/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="tutorial-title">
      <div className="card relative my-auto w-full max-w-lg bg-panel-2 p-5 shadow-2xl shadow-black/50 sm:p-6">
        <button className="absolute right-3 top-3 rounded-md p-1 text-muted hover:text-text" onClick={finish} aria-label="Skip the tutorial">
          <X className="h-4 w-4" />
        </button>
        <div className="mb-4 mr-7 flex gap-1.5" aria-label={`Step ${index + 1} of ${steps.length}`}>
          {steps.map((s, i) => (
            <span key={s} className={`h-1 flex-1 rounded-full ${i <= index ? "bg-accent" : "bg-line"}`} />
          ))}
        </div>

        {step === "welcome" && <Welcome name={user.name} />}
        {step === "source" && <SourceStep source={source} onChoose={setSource} />}
        {step === "gemini" && <GeminiStep />}
        {step === "bookmaker" && <BookmakerStep />}
        {step === "notifications" && <NotificationsStep />}
        {step === "units" && <UnitsStep onSaved={next} onBack={back} />}
        {step === "how" && <HowItWorks source={source ?? "cage"} />}
        {step === "done" && <Done source={source ?? "cage"} onFinish={finish} />}

        {step !== "units" && step !== "done" && (
          <div className="mt-6 flex items-center gap-2">
            {index > 0 ? (
              <button className="btn-ghost" onClick={back}>
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
            ) : (
              <button className="text-sm text-muted hover:text-text" onClick={finish}>
                Skip tutorial
              </button>
            )}
            <button className="btn-primary ml-auto" onClick={next} disabled={step === "source" && !source}>
              {step === "welcome" ? "Get started" : "Next"} <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Title({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h2 id="tutorial-title" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent">{icon}</span>
      {children}
    </h2>
  );
}

function Welcome({ name }: { name: string }) {
  return (
    <>
      <Title icon={<span aria-hidden="true">🏓</span>}>Welcome to TT Alarms, {name}!</Title>
      <p className="mt-3 text-sm text-muted">
        TT Alarms reminds you before each table tennis match you want to bet on, and tracks how your bets are doing.
      </p>
      <ul className="mt-3 flex flex-col gap-1.5 text-sm">
        <li className="flex gap-2">
          <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-accent" /> An alarm rings a few minutes before each match, so you never miss placing a bet.
        </li>
        <li className="flex gap-2">
          <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-accent" /> Mark bets as won or lost and see your profit in units.
        </li>
        <li className="flex gap-2">
          <Trophy className="mt-0.5 h-4 w-4 shrink-0 text-accent" /> Compare yourself with everyone on the leaderboard.
        </li>
      </ul>
      <p className="mt-3 text-xs text-muted">This takes about a minute. You can change everything later in Settings.</p>
    </>
  );
}

function SourceStep({ source, onChoose }: { source: Source | null; onChoose: (s: Source) => void }) {
  const option = (id: Source, icon: React.ReactNode, title: string, body: string) => (
    <button
      type="button"
      onClick={() => onChoose(id)}
      aria-pressed={source === id}
      className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition ${source === id ? "border-accent bg-accent/10" : "border-line hover:border-muted"}`}
    >
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${source === id ? "bg-accent text-bg" : "bg-panel text-muted"}`}>{icon}</span>
      <span>
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm text-muted">{body}</span>
      </span>
    </button>
  );
  return (
    <>
      <Title icon={<ImagePlus className="h-4 w-4" />}>Where do your picks come from?</Title>
      <p className="mt-3 text-sm text-muted">
        The <span className="font-semibold text-text">Upload</span> feature reads screenshots of <span className="font-semibold text-text">Cage Capital</span> picks, so
        you need Cage Capital to use it. No Cage Capital? You can still get the picks with <span className="font-semibold text-text">Tailing</span>.
      </p>
      <div className="mt-4 flex flex-col gap-2">
        {option("cage", <Upload className="h-4 w-4" />, "I have Cage Capital", "Upload screenshots of your picks. They're read automatically and alarms are set for each match.")}
        {option("tail", <Users className="h-4 w-4" />, "I don't have Cage Capital", "Use Tailing: copy the picks from the Tailing page to your dashboard with one click. No screenshots needed.")}
      </div>
    </>
  );
}

function GeminiStep() {
  const { settings, update } = useSettings();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saved = settings.geminiKeySource === "settings";

  const save = async () => {
    if (!key.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await update({ geminiApiKey: key.trim() });
      setKey("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Title icon={<KeyRound className="h-4 w-4" />}>Add your Gemini key</Title>
      <p className="mt-3 text-sm text-muted">
        Screenshots are read by Google&apos;s Gemini AI. Each account uses its own free key:
      </p>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
        <li>
          Open{" "}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
            aistudio.google.com/apikey <ExternalLink className="h-3 w-3" />
          </a>{" "}
          and sign in with Google.
        </li>
        <li>Click <span className="font-semibold">Create API key</span> and copy it.</li>
        <li>Paste it below.</li>
      </ol>
      {saved ? (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-over">
          <CheckCircle2 className="h-4 w-4" /> Key saved ({settings.geminiKeyHint}).
        </p>
      ) : (
        <div className="mt-3 flex gap-2">
          <input
            className="input flex-1"
            type="password"
            autoComplete="off"
            placeholder="Paste your Gemini API key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void save()}
            aria-label="Gemini API key"
          />
          <button className="btn-primary" disabled={busy || !key.trim()} onClick={() => void save()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
          </button>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-under">{error}</p>}
      {!saved && <p className="mt-2 text-xs text-muted">You can also add it later in Settings → Gemini API.</p>}
    </>
  );
}

function BookmakerStep() {
  const { settings, update } = useSettings();
  const [chosen, setChosen] = useState<Bookmaker | null>(null);
  // Changing your mind starts again from the links you had before this step.
  const [original] = useState(settings.leagueLinks);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = async (bookmaker: Bookmaker) => {
    setBusy(true);
    setError(null);
    try {
      await update({ leagueLinks: withBookmakerLinks(original, bookmaker) });
      setChosen(bookmaker);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const option = (id: Bookmaker, name: string, body: React.ReactNode, recommended = false) => (
    <button
      type="button"
      disabled={busy}
      onClick={() => void choose(id)}
      aria-pressed={chosen === id}
      className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition ${chosen === id ? "border-accent bg-accent/10" : "border-line hover:border-muted"}`}
    >
      <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${chosen === id ? "border-accent bg-accent text-bg" : "border-muted"}`}>
        {chosen === id && <Check className="h-3 w-3" />}
      </span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2 font-semibold">
          {name}
          {recommended && <span className="chip bg-over/15 text-over ring-1 ring-over/30">Recommended</span>}
        </span>
        <span className="block text-sm text-muted">{body}</span>
      </span>
    </button>
  );

  return (
    <>
      <Title icon={<ExternalLink className="h-4 w-4" />}>Which bookmaker do you use?</Title>
      <p className="mt-3 text-sm text-muted">
        Clicking the players&apos; names on a match (or the button on the alarm) opens that league on your bookmaker, so you can place the bet quickly.
      </p>
      <div className="mt-4 flex flex-col gap-2">
        {option(
          "ladbrokes",
          "Ladbrokes",
          <>
            Better limits, and it has <span className="text-text">Czech Liga Pro</span>. Covers TT Cup, TT Elite and Czech Liga Pro.
          </>,
          true,
        )}
        {option("sportsbet", "Sportsbet", <>Covers TT Cup and TT Elite (no Czech Liga Pro).</>)}
      </div>
      {chosen && (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-over">
          <CheckCircle2 className="h-4 w-4" /> League links set for {BOOKMAKER_LINKS[chosen].map((l) => l.league).join(", ")}.
        </p>
      )}
      {error && <p className="mt-1 text-xs text-under">{error}</p>}
      <p className="mt-2 text-xs text-muted">You can change these any time in Settings → League links.</p>
    </>
  );
}

function NotificationsStep() {
  const isDesktopApp = useIsDesktopApp();
  const [state, setState] = useState<PushState | "unknown">("unknown");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void detectPushState().then(setState);
  }, []);

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      await subscribeToPush();
      setState("subscribed");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState(await detectPushState());
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Title icon={<Bell className="h-4 w-4" />}>Turn on notifications</Title>
      <p className="mt-3 text-sm text-muted">
        So you get the alarm even when the app isn&apos;t open. On a computer the alarm rings until you confirm the bet; on a phone you get one notification.
      </p>
      <div className="mt-4">
        {isDesktopApp ? (
          <p className="flex items-center gap-1.5 text-sm text-over">
            <CheckCircle2 className="h-4 w-4" /> Built into the desktop app: keep it running (it sits in the tray).
          </p>
        ) : state === "subscribed" ? (
          <p className="flex items-center gap-1.5 text-sm text-over">
            <CheckCircle2 className="h-4 w-4" /> Notifications are on for this device.
          </p>
        ) : state === "ios-install" ? (
          <p className="text-sm text-warn">
            On iPhone: tap the Share button, then <span className="font-semibold">Add to Home Screen</span>, open the app from there and turn notifications on in Settings.
          </p>
        ) : state === "denied" ? (
          <p className="text-sm text-warn">Notifications are blocked. Allow them in your browser&apos;s site settings, then turn them on in Settings.</p>
        ) : state === "unsupported" ? (
          <p className="text-sm text-muted">This browser can&apos;t show notifications. Alarms still ring while the app is open.</p>
        ) : (
          <button className="btn-primary" disabled={busy || state === "unknown"} onClick={() => void enable()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />} Enable notifications
          </button>
        )}
        {error && <p className="mt-1 text-xs text-under">{error}</p>}
        <p className="mt-2 text-xs text-muted">Do this on each phone or computer you use.</p>
      </div>
    </>
  );
}

function UnitsStep({ onSaved, onBack }: { onSaved: () => void; onBack: () => void }) {
  const { settings, update } = useSettings();
  const [unitSize, setUnitSize] = useState(String(settings.unitSize));
  const [currency, setCurrency] = useState(settings.currency);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const size = Number(unitSize);
    if (!Number.isFinite(size) || size <= 0) return setError("Enter how much 1 unit is worth, e.g. 10.");
    if (!currency.trim()) return setError("Enter a currency symbol, e.g. $.");
    setBusy(true);
    setError(null);
    try {
      if (size !== settings.unitSize || currency.trim() !== settings.currency) await update({ unitSize: size, currency: currency.trim() });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Title icon={<TrendingUp className="h-4 w-4" />}>How much is 1 unit?</Title>
      <p className="mt-3 text-sm text-muted">
        Bets and profit are counted in <span className="font-semibold text-text">units</span> (1u = your normal stake). Set what 1 unit is worth to also see the money
        amount.
      </p>
      <p className="mt-2 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-sm">
        <span className="font-semibold text-accent">Tip:</span> 1 unit should be <span className="font-semibold">1-2% of your bankroll</span> (the total you&apos;ve set
        aside for betting). For example, with a {currency.trim() || "$"}1,000 bankroll, 1u = {currency.trim() || "$"}10-{currency.trim() || "$"}20.
      </p>
      <div className="mt-4 flex gap-3">
        <label className="w-24">
          <span className="label">Currency</span>
          <input className="input" value={currency} maxLength={4} onChange={(e) => setCurrency(e.target.value)} aria-label="Currency symbol" />
        </label>
        <label className="w-32">
          <span className="label">1 unit =</span>
          <input className="input tabular" inputMode="decimal" value={unitSize} onChange={(e) => setUnitSize(e.target.value)} aria-label="Value of 1 unit" />
        </label>
      </div>
      {error && <p className="mt-1 text-xs text-under">{error}</p>}
      <div className="mt-6 flex items-center gap-2">
        <button className="btn-ghost" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <button className="btn-primary ml-auto" disabled={busy} onClick={() => void save()}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Next <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </>
  );
}

function HowItWorks({ source }: { source: Source }) {
  const steps =
    source === "cage"
      ? [
          ["Upload", "Add screenshots of your Cage Capital picks. Gemini reads the players, times and stats."],
          ["Review", "Check the matches it found and confirm. An alarm is set for each one."],
          ["Alarm", "A few minutes before the match the alarm rings. Place your bet, then click \"I've placed the bet\" (you can split it, e.g. half Under, half Sweep)."],
          ["Settle", "After the match, mark it Won or Lost in the Pending section of the dashboard."],
          ["Profit", "See your profit, ROI and daily P/L on the Profit page."],
        ]
      : [
          ["Tailing", "Open the Tailing page to see the upcoming picks. Click Copy bets to add them to your dashboard."],
          ["Alarm", "A few minutes before each match the alarm rings. Place your bet, then click \"I've placed the bet\"."],
          ["Settle", "After the match, mark it Won or Lost in the Pending section of the dashboard."],
          ["Profit", "See your profit, ROI and daily P/L on the Profit page."],
        ];
  return (
    <>
      <Title icon={<BellRing className="h-4 w-4" />}>How it works</Title>
      <ol className="mt-4 flex flex-col gap-3">
        {steps.map(([title, body], i) => (
          <li key={title} className="flex gap-3">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent/15 text-xs font-semibold text-accent">{i + 1}</span>
            <span className="text-sm">
              <span className="font-semibold">{title}.</span> <span className="text-muted">{body}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-xs text-muted">
        {source === "cage" ? "You can also copy picks from the Tailing page any time. " : ""}Your bets count towards the Leaderboard.
      </p>
    </>
  );
}

function Done({ source, onFinish }: { source: Source; onFinish: () => void }) {
  const router = useRouter();
  const go = (href: string) => {
    onFinish();
    router.push(href);
  };
  return (
    <>
      <Title icon={<CheckCircle2 className="h-4 w-4" />}>You&apos;re all set!</Title>
      <p className="mt-3 text-sm text-muted">
        {source === "cage" ? "Upload your first screenshot to set your alarms." : "Head to Tailing and copy the upcoming picks to your dashboard."} You can replay this
        tutorial from Settings → Account.
      </p>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        <button className="btn-primary flex-1" onClick={() => go(source === "cage" ? "/upload" : "/tailing")}>
          {source === "cage" ? (
            <>
              <Upload className="h-4 w-4" /> Upload a screenshot
            </>
          ) : (
            <>
              <Users className="h-4 w-4" /> Open Tailing
            </>
          )}
        </button>
        <button className="btn-ghost flex-1" onClick={() => go("/")}>
          Go to the dashboard
        </button>
      </div>
    </>
  );
}
