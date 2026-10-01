import type { Selection } from "@/lib/selection";
/** Builds notification text for an alarm. Pure so it can be unit-tested. */

export interface NotificationMatch {
  id: string;
  player1: string;
  player2: string;
  competition: string | null;
  startsAt: Date;
  statistics: {
    selection: Selection | null;
    pointsLine: number | null;
    ouStats: string | null;
    ouHitRate: number | null;
    edge: number | null;
  } | null;
}

export interface NotificationPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
  matchId: string;
  alarmId: string | null;
  /** Ask the device to keep alerting (re-notify) and offer "Bet placed" buttons. */
  requireAck?: boolean;
  /** How many times this alert has been repeated (0 = first). */
  repeat?: number;
}

export function formatClock(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

export function formatPercent(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
}

export function statsLine(stats: NotificationMatch["statistics"]): string | null {
  if (!stats) return null;
  const parts: string[] = [];
  if (stats.selection) parts.push(stats.pointsLine !== null ? `${stats.selection} ${stats.pointsLine}` : stats.selection);
  if (stats.ouStats || stats.ouHitRate !== null) {
    const pct = stats.ouHitRate !== null ? formatPercent(stats.ouHitRate) : null;
    parts.push(`O/U ${[stats.ouStats, pct].filter(Boolean).join(" - ")}`);
  }
  if (stats.edge !== null) parts.push(`EDGE ${formatPercent(stats.edge)}`);
  return parts.length ? parts.join(" | ") : null;
}

export function minutesUntil(startsAt: Date, now: Date): number {
  return Math.max(0, Math.round((startsAt.getTime() - now.getTime()) / 60_000));
}

export function buildAlarmNotification(opts: {
  match: NotificationMatch;
  alarmId: string;
  generation: number;
  timezone: string;
  includeStats: boolean;
  now?: Date;
  /** Repeat number for "still ringing" re-sends (undefined/0 = first alert). */
  repeat?: number;
}): NotificationPayload {
  const now = opts.now ?? new Date();
  const { match } = opts;
  const mins = minutesUntil(match.startsAt, now);
  const when = mins <= 0 ? "starting now" : `starts in ${mins} min`;
  const lines = [[match.competition, `${formatClock(match.startsAt, opts.timezone)} (${when})`].filter(Boolean).join(" - ")];
  if (opts.includeStats) {
    const s = statsLine(match.statistics);
    if (s) lines.push(s);
  }
  if (opts.repeat) lines.push("Still waiting - tap \"Bet placed\" to stop the alarm");
  return {
    title: `${opts.repeat ? "⏰ " : ""}${match.player1} vs ${match.player2}`,
    body: lines.join("\n"),
    url: `/matches/${match.id}`,
    // Same tag as the page-shown notification, so the OS keeps a single one.
    tag: `alarm-${opts.alarmId}`,
    matchId: match.id,
    alarmId: opts.alarmId,
    repeat: opts.repeat ?? 0,
  };
}
