/** Validated extraction result produced from a single screenshot. */
export interface ExtractedMatch {
  player1: string | null;
  player2: string | null;
  competition: string | null;
  /** Verbatim start time text, e.g. "Today at 6:00 PM". */
  timeText: string | null;
  /** Verbatim date text if shown separately from the time. */
  dateText: string | null;
  selection: "OVER" | "UNDER" | null;
  pointsLine: number | null;
  /** O/U record exactly as shown, e.g. "20/9". */
  ouStats: string | null;
  /** O/U hit rate percentage 0-100. */
  ouHitRate: number | null;
  /** EDGE percentage -100..100. */
  edge: number | null;
  /** Model's confidence 0-1 that this entry was read correctly. */
  confidence: number | null;
}

export interface ExtractionResult {
  layout: string | null;
  /** Clock visible in the status bar, e.g. "17:42". */
  visibleClock: string | null;
  /** Any date visible in the screenshot chrome (not a match date). */
  visibleDate: string | null;
  /** Timezone label visible in the screenshot, e.g. "CET". */
  timezoneText: string | null;
  matches: ExtractedMatch[];
}
