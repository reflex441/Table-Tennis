import type { EspnPlayerLine } from "./espn";

/** Player prop stats and how to read them from a box score. Client-safe. */

export const STAT_CODES = ["PTS", "REB", "AST", "3PM", "STL", "BLK", "TO", "PRA", "PR", "PA", "RA", "SB"] as const;
type StatCode = (typeof STAT_CODES)[number];

export const STAT_LABEL: Record<StatCode, string> = {
  PTS: "points",
  REB: "rebounds",
  AST: "assists",
  "3PM": "threes",
  STL: "steals",
  BLK: "blocks",
  TO: "turnovers",
  PRA: "pts+reb+ast",
  PR: "pts+reb",
  PA: "pts+ast",
  RA: "reb+ast",
  SB: "steals+blocks",
};

/** "3PM", "made threes", "Points + Rebounds + Assists"... -> a stat code. */
export function statCode(text: string | null | undefined): StatCode | null {
  const t = (text ?? "").toLowerCase().replace(/&/g, "+").replace(/\band\b/g, "+").replace(/\s+/g, "");
  if (!t) return null;
  const has = (...words: string[]) => words.some((w) => t.includes(w));
  const pts = has("pts", "point");
  const reb = has("reb", "board");
  const ast = has("ast", "assist");
  if (has("pra") || (pts && reb && ast)) return "PRA";
  if (has("stl+blk", "blk+stl", "stocks") || (has("steal") && has("block"))) return "SB";
  if (pts && reb) return "PR";
  if (pts && ast) return "PA";
  if (reb && ast) return "RA";
  if (has("3pm", "3pt", "threes", "three", "3-pointer", "3pointer", "3s", "3p")) return "3PM";
  if (pts) return "PTS";
  if (reb) return "REB";
  if (ast) return "AST";
  if (has("stl", "steal")) return "STL";
  if (has("blk", "block")) return "BLK";
  if (has("turnover") || /(^|[^a-z])to($|[^a-z])/.test(t)) return "TO";
  if (/^(pr)$/.test(t)) return "PR";
  if (/^(pa)$/.test(t)) return "PA";
  if (/^(ra)$/.test(t)) return "RA";
  return null;
}

export function statValue(code: StatCode, s: NonNullable<EspnPlayerLine["stats"]>): number {
  switch (code) {
    case "PTS":
      return s.pts;
    case "REB":
      return s.reb;
    case "AST":
      return s.ast;
    case "3PM":
      return s.threes;
    case "STL":
      return s.stl;
    case "BLK":
      return s.blk;
    case "TO":
      return s.to;
    case "PRA":
      return s.pts + s.reb + s.ast;
    case "PR":
      return s.pts + s.reb;
    case "PA":
      return s.pts + s.ast;
    case "RA":
      return s.reb + s.ast;
    case "SB":
      return s.stl + s.blk;
  }
}

