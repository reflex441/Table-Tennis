import type { Selection } from "@/lib/selection";

/** The match a scanned bet slip lines up with (see findSlipReferences). */
export interface SlipReference {
  /** Found on your dashboard (the bet goes on that match) or the owner's. */
  source: "yours" | "owner";
  matchId: string;
  player1: string;
  player2: string;
  startsAt: string;
  competition: string | null;
  playType: "BOT" | "PERSONAL";
  /** The match's pick (the bot's badge for a bot play). */
  selection: Selection | null;
  ouStats: string | null;
}

/** Bot if the bot's pick was bet; a different pick, or no bot play at that time, is your own: personal. */
export function slipPlayType(ref: Pick<SlipReference, "playType" | "selection"> | null, slipSelection: Selection | null): "BOT" | "PERSONAL" {
  return ref?.playType === "BOT" && (!ref.selection || !slipSelection || ref.selection === slipSelection) ? "BOT" : "PERSONAL";
}
