import type { PrismaClient } from "@/generated/prisma/client";
import { matchDedupeKey } from "./dedupe";
import { shortPlayerName } from "./player-names";
import { tidyCompetition } from "@/lib/leagues";

/**
 * Rename stored matches with full player names ("Mariusz Koczyba") to the
 * short form ("Koczyba M."), keeping the duplicate key in step. A rename
 * that would clash with a match already stored under the short names (same
 * players, same minute) is left alone.
 */
export async function shortenStoredPlayerNames(prisma: PrismaClient): Promise<{ renamed: number; skipped: number }> {
  // Short names end in "." - only the others can need a change.
  const rows = await prisma.match.findMany({
    where: { OR: [{ NOT: { player1: { endsWith: "." } } }, { NOT: { player2: { endsWith: "." } } }] },
    select: { id: true, userId: true, player1: true, player2: true, startsAt: true },
  });
  let renamed = 0;
  let skipped = 0;
  for (const m of rows) {
    const player1 = shortPlayerName(m.player1);
    const player2 = shortPlayerName(m.player2);
    if (player1 === m.player1 && player2 === m.player2) continue;
    const dedupeKey = matchDedupeKey(player1, player2, m.startsAt);
    const clash = await prisma.match.findFirst({ where: { userId: m.userId, dedupeKey, NOT: { id: m.id } }, select: { id: true } });
    if (clash) {
      skipped++;
      continue;
    }
    await prisma.match.update({ where: { id: m.id }, data: { player1, player2, dedupeKey } });
    renamed++;
  }
  return { renamed, skipped };
}

/** Leagues stored as "TT Cup" / "TT Elite Series" become "TT CUP" / "TT ELITE". */
export async function capitalizeStoredCompetitions(prisma: PrismaClient): Promise<number> {
  const spellings = await prisma.match.groupBy({ by: ["competition"], where: { competition: { not: null } } });
  let changed = 0;
  for (const { competition } of spellings) {
    const tidy = tidyCompetition(competition);
    if (!competition || tidy === competition) continue;
    changed += (await prisma.match.updateMany({ where: { competition }, data: { competition: tidy } })).count;
  }
  return changed;
}

const state = globalThis as unknown as { __ttLastNameTidy?: number };

/** At most once an hour per server instance (called from the alarm checker). */
export async function shortenStoredPlayerNamesIfDue(prisma: PrismaClient, now = new Date()): Promise<void> {
  if (now.getTime() - (state.__ttLastNameTidy ?? 0) < 60 * 60_000) return;
  state.__ttLastNameTidy = now.getTime();
  try {
    const { renamed, skipped } = await shortenStoredPlayerNames(prisma);
    if (renamed || skipped) console.log(`[names] shortened ${renamed} match(es) to "Surname F."; ${skipped} left as they'd duplicate another match`);
    const leagues = await capitalizeStoredCompetitions(prisma);
    if (leagues) console.log(`[names] wrote the league of ${leagues} match(es) in capitals`);
  } catch (err) {
    console.error("[names] tidy failed", err);
  }
}
