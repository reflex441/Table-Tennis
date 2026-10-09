/** DTOs shared between API routes and client components (no server imports). */
import type { ExtractionResult } from "@/lib/gemini/types";
import type { CaptureSource } from "@/lib/time/resolve";
import type { Selection } from "@/lib/selection";

export type AlarmStatus = "SCHEDULED" | "SENDING" | "TRIGGERED" | "COMPLETED" | "CANCELLED" | "FAILED";

export interface MatchStatisticsDTO {
  selection: Selection | null;
  pointsLine: number | null;
  ouStats: string | null;
  ouHitRate: number | null;
  edge: number | null;
}

export interface AlarmDTO {
  id: string;
  status: AlarmStatus;
  reminderMinutes: number;
  fireAt: string;
  attempts: number;
  lastError: string | null;
  triggeredAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  /** When the user confirmed the alarm. */
  ackAt: string | null;
  ackAction: "placed" | "skipped" | null;
}

/** One pick of a split bet (e.g. 0.5u UNDER of 0.5u UNDER + 0.5u SWEEP). */
export interface BetLegDTO {
  selection: Selection;
  stake: number;
  odds: number | null;
  result: "PENDING" | "WON" | "LOST" | "VOID";
  profit: number | null;
}

export interface BetDTO {
  id: string;
  stake: number;
  odds: number | null;
  result: "PENDING" | "WON" | "LOST" | "VOID";
  profit: number | null;
  placedAt: string;
  settledAt: string | null;
  /** Picks of a split bet; empty for a normal bet. Stake/profit/result above are the totals. */
  legs: BetLegDTO[];
}

export interface MatchDTO {
  id: string;
  player1: string;
  player2: string;
  competition: string | null;
  startsAt: string;
  timezone: string;
  rawTimeText: string | null;
  notes: string | null;
  createdAt: string;
  screenshotIds: string[];
  playType: "BOT" | "PERSONAL";
  stakeUnits: number | null;
  /** Copied from a tailed account's bet. */
  copiedFrom: { id: string; name: string } | null;
  /** Odds filled in at upload; used as the bet's odds. */
  odds: number | null;
  bet: BetDTO | null;
  statistics: MatchStatisticsDTO;
  alarm: AlarmDTO | null;
}

export interface ScreenshotDTO {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  capturedAt: string | null;
  capturedAtSource: CaptureSource;
  status: "UPLOADED" | "PROCESSING" | "EXTRACTED" | "FAILED";
  error: string | null;
  imageUrl: string;
  /** True when the same image had already been uploaded. */
  duplicate: boolean;
  extraction: {
    id: string;
    model: string;
    result: ExtractionResult;
    warnings: string[];
    createdAt: string;
  } | null;
}

export interface InAppNotificationDTO {
  id: string;
  createdAt: string;
  title: string;
  body: string;
  url: string;
  matchId: string | null;
  readAt: string | null;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
