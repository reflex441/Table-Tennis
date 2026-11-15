"use client";

import { useId, useState } from "react";
import { normalizeName } from "@/lib/matching/dedupe";
import { searchPlayers, type KnownPlayer, type PastSuggestions } from "@/lib/bets/past-games";

const leaguesOf = (p: KnownPlayer) =>
  [...p.leagues]
    .sort((a, b) => b[1] - a[1])
    .map(([league]) => league)
    .join(", ");

/**
 * A player field that suggests player names from past matches as you type:
 * click one (or use the arrow keys and Enter) to fill it in. Escape closes
 * the list.
 */
export function PlayerSearch({
  label,
  value,
  suggestions,
  onChange,
}: {
  label: string;
  value: string;
  suggestions: PastSuggestions | null;
  onChange: (name: string) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const typed = value.trim().length >= 2 && suggestions ? value : "";
  const players = typed ? searchPlayers(suggestions!.players, typed) : [];
  // Closed again once you've picked one, until you type.
  const shown = open && players.length > 0;

  const pick = (i: number) => {
    const p = players[i];
    if (!p) return;
    onChange(p.name);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape" && shown) {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!players.length) return;
      e.preventDefault();
      setOpen(true);
      const n = players.length;
      setActive((a) => (e.key === "ArrowDown" ? (a + 1) % n : a <= 0 ? n - 1 : a - 1));
    } else if (e.key === "Enter" && shown && active >= 0) {
      e.preventDefault();
      pick(active);
    }
  };

  return (
    <div className="relative">
      <label className="label" htmlFor={`${id}-input`}>
        {label}
      </label>
      <input
        id={`${id}-input`}
        className="input"
        value={value}
        autoComplete="off"
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={`${id}-list`}
        aria-activedescendant={shown && active >= 0 ? `${id}-${active}` : undefined}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {shown && (
        <div
          id={`${id}-list`}
          role="listbox"
          aria-label={`${label} suggestions`}
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-line bg-panel p-1 shadow-xl shadow-black/40"
          // Keep the focus in the field, so a click picks instead of closing the list first.
          onMouseDown={(e) => e.preventDefault()}
        >
          {players.map((p, i) => (
            <button
              key={p.name}
              id={`${id}-${i}`}
              type="button"
              role="option"
              aria-selected={active === i}
              className={`flex w-full items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-left ${active === i ? "bg-panel-2" : "hover:bg-panel-2"}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(i)}
            >
              <span className={`truncate text-sm ${normalizeName(p.name) === normalizeName(value) ? "font-semibold text-text" : "text-text"}`}>{p.name}</span>
              <span className="shrink-0 text-[11px] text-muted">{[leaguesOf(p), `${p.games} game${p.games === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
