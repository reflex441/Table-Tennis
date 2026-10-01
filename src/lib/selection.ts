/** The picks a match can have. Client-safe. */
export const SELECTIONS = ["OVER", "UNDER", "SWEEP"] as const;
export type Selection = (typeof SELECTIONS)[number];

export function isSelection(v: unknown): v is Selection {
  return typeof v === "string" && (SELECTIONS as readonly string[]).includes(v);
}

export const SELECTION_LABEL: Record<Selection, string> = { OVER: "Over", UNDER: "Under", SWEEP: "Sweep" };
