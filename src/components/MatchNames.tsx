"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import type { MatchDTO } from "@/lib/types";
import { findLeagueUrl } from "@/lib/leagues";
import { useSettings } from "./SettingsProvider";

/** The bookmaker link for this match's league (Settings → League links), if set. */
export function useLeagueUrl(competition: string | null): string | null {
  const { settings } = useSettings();
  return findLeagueUrl(competition, settings.leagueLinks);
}

/**
 * "Player 1 vs Player 2". Opens the league's bookmaker page in a new tab when
 * a link is set in Settings, otherwise the match details.
 */
export function MatchNames({ match, className = "" }: { match: Pick<MatchDTO, "id" | "player1" | "player2" | "competition">; className?: string }) {
  const url = useLeagueUrl(match.competition);
  const names = (
    <>
      {match.player1} <span className="font-normal text-muted">vs</span> {match.player2}
    </>
  );
  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={`group/names inline-flex max-w-full items-center gap-1.5 hover:underline ${className}`}
        title={`Open ${match.competition} on the bookmaker`}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="truncate">{names}</span>
        <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted group-hover/names:text-accent" aria-hidden="true" />
      </a>
    );
  }
  return (
    <Link
      href={`/matches/${match.id}`}
      className={`block truncate hover:underline ${className}`}
      title={match.competition ? `No bookmaker link for ${match.competition} yet - add one in Settings → League links` : undefined}
      onClick={(e) => e.stopPropagation()}
    >
      {names}
    </Link>
  );
}
