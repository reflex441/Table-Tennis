"use client";

import { useId, useState } from "react";
import { formatDayLabel, formatTime } from "@/lib/format";
import { pickText } from "@/lib/selection";
import { searchGames, searchPlayers, type KnownPlayer, type PastGame, type PastSuggestions } from "@/lib/bets/past-games";

/** What to say about a past game in the list: league, when, the pick, and whether it's yours. */
function gameDetails(g: PastGame, tz: string, now: Date): string {
  const play = g.playType === "BOT" ? "Bot" : "Personal";
  return [
    g.competition,
    `${formatDayLabel(g.startsAt, tz, now)} ${formatTime(g.startsAt, tz)}`,
    g.selection ? `${play} ${pickText(g.selection, g.pointsLine)}` : null,
    g.bet ? "bet recorded" : g.mine ? "on your dashboard" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

const leaguesOf = (p: KnownPlayer) =>
  [...p.leagues]
    .sort((a, b) => b[1] - a[1])
    .map(([league]) => league)
    .join(", ");

/**
 * A player field that searches past games and players as you type: pick a
 * game to fill in the whole match, or a player to fill in just this name.
 * Arrow keys and Enter work too; Escape closes the list.
 */
export function PlayerSearch({
  label,
  value,
  other,
  suggestions,
  timezone,
  onChange,
  onPickGame,
}: {
  label: string;
  value: string;
  /** The other player field (games with both players come first). */
  other: string;
  suggestions: PastSuggestions | null;
  timezone: string;
  onChange: (name: string, fromList: boolean) => void;
  onPickGame: (game: PastGame) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [now] = useState(() => new Date());
  const typed = value.trim().length >= 2 && suggestions ? value : "";
  const games = typed ? searchGames(suggestions!.games, typed, other) : [];
  // A name that's already exactly right isn't suggested again.
  const players = typed ? searchPlayers(suggestions!.players, typed).filter((p) => p.name !== value.trim()) : [];
  const options = [...games.map((g) => ({ kind: "game" as const, g })), ...players.map((p) => ({ kind: "player" as const, p }))];
  const shown = open && options.length > 0;

  const pick = (i: number) => {
    const o = options[i];
    if (!o) return;
    if (o.kind === "game") onPickGame(o.g);
    else onChange(o.p.name, true);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape" && shown) {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!options.length) return;
      e.preventDefault();
      setOpen(true);
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((a) => (a + step + options.length + (a < 0 && step < 0 ? 1 : 0)) % options.length);
    } else if (e.key === "Enter" && shown && active >= 0) {
      e.preventDefault();
      pick(active);
    }
  };

  const option = (i: number, title: React.ReactNode, details: string) => (
    <button
      key={i}
      id={`${id}-${i}`}
      type="button"
      role="option"
      aria-selected={active === i}
      className={`block w-full rounded-md px-2 py-1.5 text-left ${active === i ? "bg-panel-2" : "hover:bg-panel-2"}`}
      onMouseEnter={() => setActive(i)}
      onClick={() => pick(i)}
    >
      <span className="block truncate text-sm text-text">{title}</span>
      <span className="block truncate text-[11px] text-muted">{details}</span>
    </button>
  );

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
          onChange(e.target.value, false);
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
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-lg border border-line bg-panel p-1 shadow-xl shadow-black/40"
          // Keep the focus in the field, so a click picks instead of closing the list first.
          onMouseDown={(e) => e.preventDefault()}
        >
          {games.length > 0 && <p className="px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted">Past games</p>}
          {games.map((g, i) =>
            option(
              i,
              <>
                {g.player1} <span className="text-muted">vs</span> {g.player2}
              </>,
              gameDetails(g, timezone, now),
            ),
          )}
          {players.length > 0 && <p className="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">Players</p>}
          {players.map((p, j) => option(games.length + j, p.name, [leaguesOf(p), `${p.games} game${p.games === 1 ? "" : "s"}`].filter(Boolean).join(" · ")))}
        </div>
      )}
    </div>
  );
}
