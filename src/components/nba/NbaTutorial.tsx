"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, CalendarDays, Check, CheckCircle2, RefreshCw, ScanText, TrendingUp, Users, X, Zap } from "lucide-react";
import { api } from "@/lib/client-api";
import { useSettings } from "../SettingsProvider";
import { Title } from "../Onboarding";
import { BasketballIcon } from "./BasketballIcon";

/** Dispatch on window to open the NBA tutorial again (the "How it works" button). */
export const NBA_TUTORIAL_EVENT = "tt:nba-tutorial";

const STEPS = ["welcome", "scan", "who", "details", "results", "stats", "done"] as const;
type Step = (typeof STEPS)[number];

/**
 * The NBA page's tutorial: shown the first time the page is opened (and can't
 * be skipped then, like the main one); replayed from "How it works" or
 * Settings → NBA (/nba?tutorial=1), when it can be closed.
 */
export function NbaTutorial({ firstTime }: { firstTime: boolean }) {
  const params = useSearchParams();
  const [open, setOpen] = useState(firstTime || params.get("tutorial") === "1");
  const [replay, setReplay] = useState(!firstTime);
  const [step, setStep] = useState<Step>("welcome");
  const index = STEPS.indexOf(step);

  useEffect(() => {
    const show = () => {
      setStep("welcome");
      setReplay(true);
      setOpen(true);
    };
    window.addEventListener(NBA_TUTORIAL_EVENT, show);
    return () => window.removeEventListener(NBA_TUTORIAL_EVENT, show);
  }, []);

  const finish = () => {
    setOpen(false);
    if (!replay) void api("/api/auth/me/onboarding", { method: "POST", json: { done: true, tutorial: "nba" } }).catch(() => {});
  };

  useEffect(() => {
    if (!open || !replay) return;
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
        {replay && (
          <button className="absolute right-3 top-3 rounded-md p-1 text-muted hover:text-text" onClick={finish} aria-label="Close the tutorial">
            <X className="h-4 w-4" />
          </button>
        )}
        <div className={`mb-4 flex gap-1.5 ${replay ? "mr-7" : ""}`} aria-label={`Step ${index + 1} of ${STEPS.length}`}>
          {STEPS.map((s, i) => (
            <span key={s} className={`h-1 flex-1 rounded-full ${i <= index ? "bg-orange-400" : "bg-line"}`} />
          ))}
        </div>

        {step === "welcome" && <Welcome />}
        {step === "scan" && <Scan />}
        {step === "who" && <Who />}
        {step === "details" && <Details />}
        {step === "results" && <Results />}
        {step === "stats" && <Stats />}
        {step === "done" && <Done />}

        <div className="mt-6 flex items-center gap-2">
          {index > 0 && (
            <button className="btn-ghost" onClick={() => setStep(STEPS[index - 1])}>
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
          )}
          {step === "done" ? (
            <button className="btn-primary ml-auto" onClick={finish}>
              <Check className="h-4 w-4" /> Start tracking
            </button>
          ) : (
            <button className="btn-primary ml-auto" onClick={() => setStep(STEPS[index + 1])}>
              {step === "welcome" ? "Show me" : "Next"} <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Point({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="mt-0.5 shrink-0 text-orange-400">{icon}</span>
      <span>{children}</span>
    </li>
  );
}

function Welcome() {
  const { settings } = useSettings();
  return (
    <>
      <Title icon={<BasketballIcon className="h-4 w-4 text-orange-400" />}>NBA bets</Title>
      <p className="mt-3 text-sm text-muted">
        Track tipsters&apos; NBA picks here - separate from table tennis. There are no alarms: you add the picks, and the app keeps score.
      </p>
      <ul className="mt-3 flex flex-col gap-1.5 text-sm">
        <Point icon={<ScanText className="h-4 w-4" />}>Add picks from a screenshot of the tipster&apos;s message.</Point>
        <Point icon={<Zap className="h-4 w-4" />}>Results fill themselves in from ESPN after the game.</Point>
        <Point icon={<TrendingUp className="h-4 w-4" />}>See each tipster&apos;s profit and ROI, and your NBA + table tennis total.</Point>
      </ul>
      <p className="mt-3 text-xs text-muted">
        Profit is in units, like table tennis: 1u = {settings.currency}
        {settings.unitSize} (Settings → Units).
      </p>
    </>
  );
}

function Scan() {
  return (
    <>
      <Title icon={<ScanText className="h-4 w-4" />}>Adding picks</Title>
      <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm">
        <li>
          Screenshot the tipster&apos;s message (e.g. on Discord) and press <b>Scan picks</b>. Several bets in one message become several rows.
        </li>
        <li>
          Each row is filled in: the pick, <b>units</b> (&quot;1.5u&quot;), <b>odds</b>, <b>bookmaker</b> and the game. American odds are turned into
          decimal (+138 = 2.38).
        </li>
        <li>
          Check the rows, then <b>Add</b>. Scanning the same screenshot twice won&apos;t add the bets twice.
        </li>
      </ol>
      <p className="mt-3 text-sm text-muted">
        No screenshot? <b className="text-text">Add bet</b> types one in. Every bet can be edited (pencil) or deleted (bin) later.
      </p>
    </>
  );
}

function Who() {
  const { settings } = useSettings();
  const tipsters = settings.nbaTipsters.slice(0, 3);
  const books = settings.nbaBookmakers.slice(0, 3);
  return (
    <>
      <Title icon={<Users className="h-4 w-4" />}>Tipsters and bookmakers</Title>
      <p className="mt-3 text-sm text-muted">
        <b className="text-text">Whose pick</b> comes from who sent the message. Names you list are renamed; anyone else is tracked under the name they post
        with.
      </p>
      <ul className="mt-2 flex flex-wrap gap-1.5 text-xs">
        {tipsters.map((t) => (
          <li key={t.match} className="chip bg-line text-text">
            {t.match} → {t.name}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-muted">
        <b className="text-text">Bookmaker codes</b> are turned into names. With several odds listed (&quot;+138 FD +137 NV&quot;), the first bookmaker counts.
      </p>
      <ul className="mt-2 flex flex-wrap gap-1.5 text-xs">
        {books.map((b) => (
          <li key={b.code} className="chip bg-line text-text">
            {b.code} → {b.name}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted">Change both lists in Settings → NBA.</p>
    </>
  );
}

function Details() {
  return (
    <>
      <Title icon={<CalendarDays className="h-4 w-4" />}>Game date and details</Title>
      <p className="mt-3 text-sm text-muted">
        <b className="text-text">Game date</b> is the day the game is played - your date or the US date both work. If the screenshot doesn&apos;t show the game,
        the result comes from the team&apos;s next game after the pick was posted.
      </p>
      <p className="mt-3 text-sm text-muted">The dashed box under each bet holds what&apos;s needed to settle it automatically:</p>
      <ul className="mt-2 flex flex-col gap-1 text-sm">
        <li>
          <b>Player props:</b> player, stat (PTS, 3PM, PRA...), line and Over/Under.
        </li>
        <li>
          <b>Moneyline / spread:</b> the team bet on (and the spread, e.g. -4.5).
        </li>
        <li>
          <b>Totals:</b> a team in the game, the line and Over/Under.
        </li>
      </ul>
      <p className="mt-3 text-xs text-muted">The scan fills these in - just check them. Futures and parlays are marked Won / Lost by you.</p>
    </>
  );
}

function Results() {
  return (
    <>
      <Title icon={<Zap className="h-4 w-4" />}>Results by themselves</Title>
      <p className="mt-3 text-sm text-muted">
        About <b className="text-text">an hour after the game ends</b>, the result is read from ESPN&apos;s box score or final score and the bet is marked Won or
        Lost - with an <span className="chip bg-accent/15 text-accent">auto</span> tag and what it found:
      </p>
      <p className="mt-2 rounded-md border border-line bg-bg px-2 py-1.5 text-xs text-accent">auto · De&apos;Aaron Fox: 3 threes (line 1.5).</p>
      <ul className="mt-3 flex flex-col gap-1.5 text-sm">
        <Point icon={<RefreshCw className="h-4 w-4" />}>
          <b>Check results</b> looks right away instead of waiting.
        </Point>
        <Point icon={<CheckCircle2 className="h-4 w-4" />}>A player who didn&apos;t play, or a result exactly on the line, is Void.</Point>
        <Point icon={<CheckCircle2 className="h-4 w-4" />}>Not settled? The grey note under the bet says why (e.g. a name ESPN spells differently).</Point>
      </ul>
      <p className="mt-3 text-xs text-muted">You always have the final say: Won / Lost / Void buttons, or undo, on any bet.</p>
    </>
  );
}

function Stats() {
  return (
    <>
      <Title icon={<TrendingUp className="h-4 w-4" />}>Your stats</Title>
      <ul className="mt-3 flex flex-col gap-1.5 text-sm">
        <li>
          <b>NBA, Table tennis and Combined</b> cards: profit, ROI, win rate and record for each, and both together.
        </li>
        <li>
          <b>Tipsters</b>: each tipster&apos;s bets, record, win rate, ROI and profit. Click one to see only their picks.
        </li>
        <li>
          <b>Running profit</b> (NBA or combined) and a <b>Daily P/L</b> calendar - click a day to see its bets.
        </li>
        <li>
          <b>By bookmaker</b>, once you use more than one.
        </li>
      </ul>
    </>
  );
}

function Done() {
  return (
    <>
      <Title icon={<Check className="h-4 w-4" />}>You&apos;re set</Title>
      <p className="mt-3 text-sm text-muted">Scan your first tipster&apos;s picks to get started.</p>
      <p className="mt-3 text-sm text-muted">
        To see this again, press <b className="text-text">How it works</b> at the top of the NBA page (or Settings → NBA).
      </p>
    </>
  );
}
