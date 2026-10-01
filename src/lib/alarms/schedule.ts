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
 * Dashboard sections, in order: Upcoming -> Triggered -> Pending (bet placed,
 * not settled yet) -> Completed (settled, finished or cancelled).
 */
export const SECTIONS = ["upcoming", "triggered", "pending", "completed"] as const;
export type Section = (typeof SECTIONS)[number];

/** Section for a match: a placed but unsettled bet is Pending; otherwise the alarm decides. */
export function sectionFor(alarmStatus: string | null | undefined, betResult: string | null | undefined): Section {
  if (betResult === "PENDING") return "pending";
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

export const SECTION_STATUSES: Record<Exclude<Section, "pending">, string[]> = {
  upcoming: ["SCHEDULED", "SENDING"],
  triggered: ["TRIGGERED", "FAILED"],
  completed: ["COMPLETED", "CANCELLED"],
};
