import type { NbaBet, PrismaClient } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { ServiceError } from "@/lib/alarms/service-error";
import { computeProfit, round2, type BetResult } from "@/lib/bets/profit";
import type { NbaBetInput, NbaBetUpdate } from "@/lib/validation/nba";
import { nbaDedupeKey, type NbaMarket } from "./parse";

/** An NBA bet as sent to the browser. */
export interface NbaBetDTO {
  id: string;
  tipster: string;
  pick: string;
  market: NbaMarket;
  game: string | null;
  team: string | null;
  player: string | null;
  stat: string | null;
  line: number | null;
  side: "OVER" | "UNDER" | null;
  stake: number;
  odds: number | null;
  bookmaker: string | null;
  placedAt: string;
  result: BetResult;
  profit: number | null;
  settledAt: string | null;
  notes: string | null;
  /** Settled automatically from ESPN. */
  autoGraded: boolean;
  /** What the automatic check found or is waiting for. */
  gradeNote: string | null;
}

export function toNbaBetDTO(b: NbaBet): NbaBetDTO {
  return {
    id: b.id,
    tipster: b.tipster,
    pick: b.pick,
    market: b.market as NbaMarket,
    game: b.game,
    team: b.team,
    player: b.player,
    stat: b.stat,
    line: b.line,
    side: b.side === "OVER" || b.side === "UNDER" ? b.side : null,
    stake: b.stake,
    odds: b.odds,
    bookmaker: b.bookmaker,
    placedAt: b.placedAt.toISOString(),
    result: b.result as BetResult,
    profit: b.profit,
    settledAt: b.settledAt?.toISOString() ?? null,
    notes: b.notes,
    autoGraded: b.autoGraded,
    gradeNote: b.gradeNote,
  };
}

export async function listNbaBets(prisma: PrismaClient, userId: string): Promise<NbaBetDTO[]> {
  const rows = await prisma.nbaBet.findMany({ where: { userId }, orderBy: { placedAt: "desc" }, take: 5000 });
  return rows.map(toNbaBetDTO);
}

const duplicate = (existingId?: string) => new ServiceError("You already have this pick (same tipster, pick and time).", 409, "duplicate", existingId ? { existingId } : undefined);

export async function createNbaBet(prisma: PrismaClient, userId: string, input: NbaBetInput, now = new Date()): Promise<NbaBetDTO> {
  const placedAt = new Date(input.placedAt);
  const dedupeKey = nbaDedupeKey(input.tipster, input.pick, placedAt);
  const existing = await prisma.nbaBet.findUnique({ where: { userId_dedupeKey: { userId, dedupeKey } }, select: { id: true } });
  if (existing) throw duplicate(existing.id);
  const result = input.result as BetResult;
  const stake = round2(input.stake);
  const bet = await prisma.nbaBet.create({
    data: {
      userId,
      tipster: input.tipster,
      pick: input.pick,
      market: input.market,
      game: input.game,
      team: input.team,
      player: input.player,
      stat: input.stat,
      line: input.line,
      side: input.side,
      stake,
      odds: input.odds,
      bookmaker: input.bookmaker,
      placedAt,
      result,
      profit: computeProfit(stake, input.odds, result),
      settledAt: result === "PENDING" ? null : now,
      notes: input.notes,
      dedupeKey,
    },
  });
  return toNbaBetDTO(bet);
}

/** Edit any field or settle it; the profit is worked out again every time. */
export async function updateNbaBet(prisma: PrismaClient, userId: string, id: string, input: NbaBetUpdate, now = new Date()): Promise<NbaBetDTO> {
  const bet = await prisma.nbaBet.findFirst({ where: { id, userId } });
  if (!bet) throw new ServiceError("Bet not found.", 404, "not_found");
  const tipster = input.tipster ?? bet.tipster;
  const pick = input.pick ?? bet.pick;
  const placedAt = input.placedAt ? new Date(input.placedAt) : bet.placedAt;
  const stake = input.stake !== undefined ? round2(input.stake) : bet.stake;
  const odds = input.odds !== undefined ? input.odds : bet.odds;
  const result = (input.result ?? bet.result) as BetResult;
  // Changing what the bet is (or its date) means checking ESPN again soon.
  const regrade = (["pick", "placedAt", "market", "game", "team", "player", "stat", "line", "side"] as const).some((k) => input[k] !== undefined);
  try {
    const updated = await prisma.nbaBet.update({
      where: { id },
      data: {
        tipster,
        pick,
        placedAt,
        stake,
        odds,
        result,
        ...(input.market !== undefined ? { market: input.market } : {}),
        ...(input.game !== undefined ? { game: input.game } : {}),
        ...(input.team !== undefined ? { team: input.team } : {}),
        ...(input.player !== undefined ? { player: input.player } : {}),
        ...(input.stat !== undefined ? { stat: input.stat } : {}),
        ...(input.line !== undefined ? { line: input.line } : {}),
        ...(input.side !== undefined ? { side: input.side } : {}),
        ...(input.bookmaker !== undefined ? { bookmaker: input.bookmaker } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        profit: computeProfit(stake, odds, result),
        settledAt: result === "PENDING" ? null : (bet.settledAt ?? now),
        dedupeKey: nbaDedupeKey(tipster, pick, placedAt),
        // Settled by you: no longer marked as automatic.
        ...(input.result !== undefined ? { autoGraded: false } : {}),
        ...(regrade || input.result === "PENDING" ? { gradeCheckedAt: null, gradeNote: null } : {}),
      },
    });
    return toNbaBetDTO(updated);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw duplicate();
    throw err;
  }
}

export async function deleteNbaBet(prisma: PrismaClient, userId: string, id: string): Promise<void> {
  const { count } = await prisma.nbaBet.deleteMany({ where: { id, userId } });
  if (!count) throw new ServiceError("Bet not found.", 404, "not_found");
}
