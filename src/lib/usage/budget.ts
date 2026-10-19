/**
 * Staying within the host's free server time (Vercel Hobby: 4 hours of
 * active CPU a month; past that it pauses the site). The app measures the
 * CPU it uses (see meter.ts); as the last 30 days fill up, open apps check
 * the server less often, in steps. Client-safe.
 */

/** The monthly allowance in hours of CPU (CPU_BUDGET_HOURS overrides it). */
export const DEFAULT_BUDGET_HOURS = 4;

export type SavingLevel = 0 | 1 | 2 | 3;

/** Share of the allowance used (last 30 days) where each saving step starts. */
const STEPS = [0.35, 0.55, 0.75] as const;

export function savingLevel(cpuMs: number, budgetMs: number): SavingLevel {
  const used = budgetMs > 0 ? cpuMs / budgetMs : 0;
  return used >= STEPS[2] ? 3 : used >= STEPS[1] ? 2 : used >= STEPS[0] ? 1 : 0;
}

export interface PollSeconds {
  /** In-app notifications (only while the app is on screen). */
  notifications: number;
  /** Dashboard reload (only while on screen; 0 = only when an alarm goes off or you come back to it). */
  dashboard: number;
  /** Computer alarm: ringing alarms (also in the background). Push messages still ring it straight away. */
  ringer: number;
}

/** How often open apps check the server at each step. */
export const POLL_SECONDS: Record<SavingLevel, PollSeconds> = {
  0: { notifications: 30, dashboard: 60, ringer: 30 },
  1: { notifications: 60, dashboard: 180, ringer: 30 },
  2: { notifications: 120, dashboard: 600, ringer: 45 },
  3: { notifications: 300, dashboard: 0, ringer: 60 },
};

export const SAVING_LABEL: Record<SavingLevel, string> = {
  0: "Off",
  1: "Light (apps check every minute)",
  2: "Strong (apps check every 2 minutes)",
  3: "Maximum (apps check every 5 minutes; the computer alarm every minute)",
};
