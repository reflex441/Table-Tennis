"use client";

import { COMPETITIONS, canonicalCompetition } from "@/lib/leagues";

/** League picker: TT Elite, TT Cup or Czech Liga Pro (or none). */
export function LeagueSelect({ value, onChange, className = "input" }: { value: string; onChange: (value: string) => void; className?: string }) {
  return (
    <select className={className} value={canonicalCompetition(value) ?? ""} onChange={(e) => onChange(e.target.value)} aria-label="League">
      <option value="">—</option>
      {COMPETITIONS.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}
