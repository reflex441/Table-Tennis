import type { PrismaClient } from "@/generated/prisma/client";
import { computeProfit } from "@/lib/bets/profit";
import { createEspnClient, type EspnClient } from "./espn";
import { AUTO_MARKETS, gradeBet } from "./grade";

/** A bet is checked at most this often (ESPN is only asked about games that could be over). */
const RECHECK_MS = 20 * 60_000;
/** Bets older than this are only checked with "Check results" (which looks back a year, e.g. to test it on a past game). */
const MAX_AGE_MS = 5 * 24 * 3_600_000;
const MAX_AGE_FORCED_MS = 400 * 24 * 3_600_000;

export interface GradeReport {
  checked: number;
  settled: number;
  waiting: number;
  failed: number;
  /** What each checked bet came to, for the "Check results" message. */
  notes: { pick: string; note: string; settled: boolean }[];
}

/**
 * Check pending NBA bets against ESPN and settle the ones whose game is over.
 * Only bets on player props, moneylines, spreads and totals whose game date
 * has come are looked at; each is checked at most every 20 minutes (every
 * minute with `force`, the "Check results" button). Stops after `budgetMs`.
 */
export async function gradePendingNbaBets(
  prisma: PrismaClient,
  opts: { userId?: string; espn?: EspnClient; now?: Date; force?: boolean; budgetMs?: number; limit?: number } = {},
): Promise<GradeReport> {
  const now = opts.now ?? new Date();
  const espn = opts.espn ?? createEspnClient();
  const started = Date.now();
  const recheck = opts.force ? 60_000 : RECHECK_MS;
  const bets = await prisma.nbaBet.findMany({
    where: {
      ...(opts.userId ? { userId: opts.userId } : {}),
      result: "PENDING",
      market: { in: AUTO_MARKETS },
      placedAt: { lte: new Date(now.getTime() + 24 * 3_600_000), gte: new Date(now.getTime() - (opts.force ? MAX_AGE_FORCED_MS : MAX_AGE_MS)) },
      OR: [{ gradeCheckedAt: null }, { gradeCheckedAt: { lte: new Date(now.getTime() - recheck) } }],
    },
    orderBy: { placedAt: "asc" },
    take: opts.limit ?? 60,
  });
  const report: GradeReport = { checked: 0, settled: 0, waiting: 0, failed: 0, notes: [] };
  // Each user's timezone: a typed-in game date is that day where they are.
  const zones = new Map(
    (await prisma.settings.findMany({ where: { userId: { in: [...new Set(bets.map((b) => b.userId))] } }, select: { userId: true, timezone: true } })).map((z) => [z.userId, z.timezone]),
  );
  for (const bet of bets) {
    if (Date.now() - started > (opts.budgetMs ?? 20_000)) break;
    report.checked++;
    try {
      const outcome = await gradeBet(
        {
          market: bet.market as never,
          pick: bet.pick,
          team: bet.team,
          game: bet.game,
          player: bet.player,
          stat: bet.stat,
          line: bet.line,
          side: bet.side as never,
          placedAt: bet.placedAt,
          dateKind: bet.dateKind === "POSTED" ? "POSTED" : "GAME",
          timezone: zones.get(bet.userId) ?? "Australia/Sydney",
        },
        espn,
        now,
      );
      report.notes.push({ pick: bet.pick, note: outcome.note, settled: outcome.kind === "settled" });
      // A posted time becomes the game's date once the game is known.
      const gameDate = bet.dateKind === "POSTED" && outcome.kind !== "manual" && outcome.gameStart ? { placedAt: outcome.gameStart, dateKind: "GAME" } : {};
      if (outcome.kind === "settled") {
        report.settled++;
        // Only if it's still pending (you may have settled it meanwhile).
        await prisma.nbaBet.updateMany({
          where: { id: bet.id, result: "PENDING" },
          data: {
            result: outcome.result,
            profit: computeProfit(bet.stake, bet.odds, outcome.result),
            settledAt: now,
            autoGraded: true,
            gradeNote: outcome.note,
            gradeCheckedAt: now,
            espnEventId: outcome.eventId,
            ...gameDate,
          },
        });
      } else {
        if (outcome.kind === "wait") report.waiting++;
        await prisma.nbaBet.update({
          where: { id: bet.id },
          data: { gradeNote: outcome.note, gradeCheckedAt: now, ...(outcome.kind === "wait" && outcome.eventId ? { espnEventId: outcome.eventId } : {}), ...gameDate },
        });
      }
    } catch (err) {
      // ESPN down or changed: try again later, the bet stays pending.
      report.failed++;
      const why = err instanceof Error ? err.message : String(err);
      console.warn(`[nba] couldn't check bet ${bet.id}: ${why}`);
      const note = `Couldn't reach ESPN (${why.slice(0, 80)}) - will try again.`;
      report.notes.push({ pick: bet.pick, note, settled: false });
      await prisma.nbaBet.update({ where: { id: bet.id }, data: { gradeNote: note, gradeCheckedAt: now } });
    }
  }
  return report;
}

const state = globalThis as unknown as { __ttLastNbaGrading?: number };

/** At most every 10 minutes per server instance (called from the alarm checker). */
export async function gradeNbaBetsIfDue(prisma: PrismaClient, now = new Date()): Promise<void> {
  if (now.getTime() - (state.__ttLastNbaGrading ?? 0) < 10 * 60_000) return;
  state.__ttLastNbaGrading = now.getTime();
  try {
    const r = await gradePendingNbaBets(prisma, { now });
    if (r.checked) console.log(`[nba] checked ${r.checked} bet(s): ${r.settled} settled, ${r.waiting} waiting, ${r.failed} failed`);
  } catch (err) {
    console.error("[nba] grading failed", err);
  }
}
