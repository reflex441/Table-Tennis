"use client";

import { useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { DateTime } from "luxon";
import { parseDayFirstDate } from "@/lib/format";

/**
 * Date and time input, Australian style: the date is typed DD/MM/YYYY (the
 * browser's own date box follows its language, often month-first), with a
 * calendar button and the day written out underneath ("Wed 7 Oct 2026").
 * `value` / `onChange` use the "yyyy-MM-ddTHH:mm" form of a datetime-local
 * input, so it drops in where one was used.
 */
export function DateTimeInput({
  value,
  onChange,
  label = "Date and time",
  compact = false,
  max,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  compact?: boolean;
  /** Latest allowed value (same form as value), for the calendar. */
  max?: string;
}) {
  const [datePart, timePart] = splitValue(value);
  const [draft, setDraft] = useState(toDisplay(datePart));
  const [seen, setSeen] = useState(value);
  const picker = useRef<HTMLInputElement>(null);
  // Follow changes made from outside (e.g. a time worked out again).
  if (seen !== value) {
    setSeen(value);
    setDraft(toDisplay(datePart));
  }

  const parsed = parseDayFirstDate(draft);
  const valid = draft.trim() === "" || parsed !== null;
  const shown = parsed ?? datePart;
  const day = shown ? DateTime.fromISO(shown) : null;
  const pad = compact ? "py-1" : "";

  const setDate = (iso: string | null) => {
    if (iso) onChange(`${iso}T${timePart || "12:00"}`);
  };

  return (
    <div>
      <div className="flex gap-1.5">
        <input
          className={`input ${pad} w-[7.5rem] tabular ${valid ? "" : "border-under"}`}
          inputMode="numeric"
          placeholder="DD/MM/YYYY"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setDate(parseDayFirstDate(e.target.value));
          }}
          onBlur={() => parsed && setDraft(toDisplay(parsed))}
          aria-label={`${label}: date (DD/MM/YYYY)`}
        />
        <button
          type="button"
          className={`btn-ghost ${pad} px-2`}
          onClick={() => {
            const el = picker.current;
            if (!el) return;
            if (typeof el.showPicker === "function") el.showPicker();
            else el.click();
          }}
          aria-label="Pick a date"
          title="Pick a date"
        >
          <CalendarDays className="h-4 w-4" />
        </button>
        <input
          ref={picker}
          type="date"
          tabIndex={-1}
          aria-hidden="true"
          className="pointer-events-none absolute h-0 w-0 opacity-0"
          value={datePart}
          max={max ? splitValue(max)[0] : undefined}
          onChange={(e) => {
            setDraft(toDisplay(e.target.value));
            setDate(e.target.value || null);
          }}
        />
        <input
          type="time"
          className={`input ${pad} w-[7.5rem] tabular`}
          value={timePart}
          onChange={(e) => e.target.value && onChange(`${datePart || DateTime.now().toISODate()}T${e.target.value}`)}
          aria-label={`${label}: time`}
        />
      </div>
      <p className={`mt-0.5 text-[11px] ${valid ? "text-muted" : "text-under"}`}>
        {!valid ? "Use DD/MM/YYYY, e.g. 07/10/2026" : day?.isValid ? day.toFormat("ccc d LLL yyyy") : " "}
      </p>
    </div>
  );
}

function splitValue(value: string): [string, string] {
  const [d = "", t = ""] = (value ?? "").split("T");
  return [d, t.slice(0, 5)];
}

/** "2026-10-07" -> "07/10/2026". */
function toDisplay(iso: string): string {
  const dt = iso ? DateTime.fromISO(iso) : null;
  return dt?.isValid ? dt.toFormat("dd/MM/yyyy") : "";
}
