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

/** Dashboard section for an alarm status. */
export type Section = "upcoming" | "triggered" | "completed" | "cancelled";

export function sectionForStatus(status: string): Section {
  switch (status) {
    case "SCHEDULED":
    case "SENDING":
      return "upcoming";
    case "TRIGGERED":
    case "FAILED":
      return "triggered";
    case "COMPLETED":
      return "completed";
    default:
      return "cancelled";
  }
}

export const SECTION_STATUSES: Record<Section, string[]> = {
  upcoming: ["SCHEDULED", "SENDING"],
  triggered: ["TRIGGERED", "FAILED"],
  completed: ["COMPLETED"],
  cancelled: ["CANCELLED"],
};
