import { DateTime } from "luxon";

/** Client-safe formatting helpers. */

export function formatTime(iso: string, timezone: string): string {
  return DateTime.fromISO(iso).setZone(timezone).toFormat("h:mm a");
}

export function formatDayLabel(iso: string, timezone: string, now: Date = new Date()): string {
  const dt = DateTime.fromISO(iso).setZone(timezone).startOf("day");
  const today = DateTime.fromJSDate(now).setZone(timezone).startOf("day");
  const diff = Math.round(dt.diff(today, "days").days);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 1 && diff < 7) return dt.toFormat("cccc");
  return dt.toFormat(dt.year === today.year ? "ccc d LLL" : "d LLL yyyy");
}

export function formatDateTime(iso: string, timezone: string): string {
  return DateTime.fromISO(iso).setZone(timezone).toFormat("ccc d LLL yyyy, HH:mm");
}

/** Value for <input type="datetime-local"> in the given timezone. */
export function toLocalInputValue(iso: string | null, timezone: string): string {
  if (!iso) return "";
  const dt = DateTime.fromISO(iso).setZone(timezone);
  return dt.isValid ? dt.toFormat("yyyy-MM-dd'T'HH:mm") : "";
}

/** Parse a datetime-local value as wall-clock time in `timezone` → ISO UTC. */
export function fromLocalInputValue(value: string, timezone: string): string | null {
  if (!value) return null;
  const dt = DateTime.fromISO(value, { zone: timezone });
  return dt.isValid ? dt.toUTC().toISO() : null;
}

export function formatCountdown(ms: number): string {
  if (ms <= 0) return "Started";
  const totalSeconds = Math.floor(ms / 1000);
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (d > 0) return `${d}d ${h}h ${pad(m)}m`;
  if (h > 0) return `${h}h ${pad(m)}m ${pad(s)}s`;
  return `${pad(m)}:${pad(s)}`;
}

export function formatReminder(minutes: number): string {
  if (minutes === 0) return "Alert at start";
  if (minutes < 60) return `Alert ${minutes} min before`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `Alert ${h}h${m ? ` ${m}m` : ""} before`;
}

export function formatPct(n: number | null): string {
  if (n === null || n === undefined) return "–";
  return `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function listTimeZones(): string[] {
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    if (fn) return fn("timeZone");
  } catch {
    /* ignore */
  }
  return ["UTC", "Europe/London", "Europe/Prague", "Europe/Berlin", "Europe/Moscow", "America/New_York", "America/Los_Angeles", "Asia/Tokyo", "Australia/Sydney"];
}
