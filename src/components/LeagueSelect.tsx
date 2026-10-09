"use client";

import { COMPETITIONS, canonicalCompetition } from "@/lib/leagues";

/**
 * League picker: TT ELITE, TT CUP or CZECH LIGA PRO (or none). A league
 * outside those three that's already saved stays listed, so nothing is lost.
 */
export function LeagueSelect({ value, onChange, className = "input" }: { value: string; onChange: (value: string) => void; className?: string }) {
  const known = canonicalCompetition(value);
  const other = !known && value.trim() ? value.trim() : null;
  return (
    <select className={className} value={known ?? other ?? ""} onChange={(e) => onChange(e.target.value)} aria-label="League">
      <option value="">—</option>
      {COMPETITIONS.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
      {other && <option value={other}>{other}</option>}
    </select>
  );
}
