/** Pure alarm-time helpers. */

export function computeFireAt(startsAt: Date, reminderMinutes: number): Date {
  return new Date(startsAt.getTime() - reminderMinutes * 60_000);
}

export type ScheduleCheck =
  | { ok: true; fireAt: Date; immediate: boolean }
  | { ok: false; reason: string };

/**
 * Validate that an alarm can be scheduled. If the reminder time has already
 * passed but the match has not started, the alarm fires immediately.
 */
export function checkSchedule(startsAt: Date, reminderMinutes: number, now: Date = new Date()): ScheduleCheck {
  if (Number.isNaN(startsAt.getTime())) return { ok: false, reason: "Invalid start time." };
  if (startsAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "The match start time is in the past." };
  }
  const fireAt = computeFireAt(startsAt, reminderMinutes);
  return { ok: true, fireAt, immediate: fireAt.getTime() <= now.getTime() };
}

/**
 * Dashboard sections, in order: Upcoming -> Triggered -> Pending (match
 * started, bet not settled yet) -> Completed (settled, finished or cancelled).
 */
export const SECTIONS = ["upcoming", "triggered", "pending", "completed"] as const;
export type Section = (typeof SECTIONS)[number];

export interface SectionInput {
  alarm: { status: string; ackAction?: string | null } | null;
  bet: { result: string } | null;
}

/**
 * Section for a match. Only "Bet placed" (on the card or the alarm) moves a
 * match with an unsettled bet to Pending, where it stays until it is marked
 * won/lost. A bet that is only recorded doesn't: the alarm still rings and
 * the alarm decides the section.
 */
export function sectionFor(m: SectionInput): Section {
  const alarmStatus = m.alarm?.status;
  if (m.bet?.result === "PENDING" && m.alarm?.ackAction === "placed") return "pending";
  switch (alarmStatus ?? "SCHEDULED") {
    case "SCHEDULED":
    case "SENDING":
      return "upcoming";
    case "TRIGGERED":
    case "FAILED":
      return "triggered";
    default:
      return "completed"; // COMPLETED or CANCELLED
  }
}

