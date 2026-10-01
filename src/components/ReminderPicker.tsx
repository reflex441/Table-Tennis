"use client";

import { useState } from "react";
import { REMINDER_PRESETS } from "@/lib/validation/match";

/** Preset chips (1/3/5/10/15/30 min) plus a custom minutes input. */
export function ReminderPicker({ value, onChange, compact = false, id }: { value: number; onChange: (minutes: number) => void; compact?: boolean; id?: string }) {
  const isPreset = (REMINDER_PRESETS as readonly number[]).includes(value);
  const [custom, setCustom] = useState(!isPreset);
  const [draft, setDraft] = useState(String(value));

  return (
    <div className="flex flex-wrap items-center gap-1" id={id}>
      {REMINDER_PRESETS.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => {
            setCustom(false);
            onChange(m);
          }}
          className={`rounded-md border px-2 py-1 text-xs font-medium tabular ${
            !custom && value === m ? "border-accent bg-accent/15 text-accent" : "border-line bg-bg text-muted hover:text-text"
          } ${compact ? "px-1.5" : ""}`}
        >
          {m}m
        </button>
      ))}
      <button
        type="button"
        onClick={() => {
          setCustom(true);
          setDraft(String(value));
        }}
        className={`rounded-md border px-2 py-1 text-xs font-medium ${custom ? "border-accent bg-accent/15 text-accent" : "border-line bg-bg text-muted hover:text-text"}`}
      >
        Custom
      </button>
      {custom && (
        <span className="flex items-center gap-1">
          <input
            type="number"
            min={0}
            max={1440}
            inputMode="numeric"
            aria-label="Custom reminder minutes"
            className="input w-20 py-1 text-xs"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              const n = Number(e.target.value);
              if (e.target.value !== "" && Number.isInteger(n) && n >= 0 && n <= 1440) onChange(n);
            }}
          />
          <span className="text-xs text-muted">min</span>
        </span>
      )}
    </div>
  );
}
