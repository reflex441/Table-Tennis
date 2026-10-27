import type { PrismaClient } from "@/generated/prisma/client";
import { ServiceError } from "@/lib/alarms/service-error";
import { getTailedAccount } from "@/lib/tailing";
import { createNbaBet, listNbaBets, type NbaBetDTO } from "./service";
import { nbaDedupeKey, type NbaMarket } from "./parse";

/**
 * NBA on the Tailing page: the owner's NBA picks and record, for the
 * accounts the owner allowed (Settings → Accounts → NBA tailing). Open picks
 * can be copied to your own NBA page, where ESPN settles them as usual.
 * Futures are left out (not shown, counted or copied).
 */

/** Futures aren't shared. */
const shared = (b: { market: string }) => b.market !== "FUTURE";

export type NbaTailBet = NbaBetDTO & {
  /** Open pick that's already on your NBA page (same tipster, pick and time). */
  copied: boolean;
};

export interface NbaTail {
  bets: NbaTailBet[];
  /** You are the owner (what the allowed accounts see). */
  isSelf: boolean;
}

/** The owner's id if `viewerId` may see their NBA picks: the owner, and accounts with NBA tailing on. */
async function access(prisma: PrismaClient, viewerId: string): Promise<{ ownerId: string; isSelf: boolean } | null> {
  const owner = await getTailedAccount(prisma);
  if (!owner) return null;
  if (owner.id === viewerId) return { ownerId: owner.id, isSelf: true };
  const viewer = await prisma.user.findUnique({ where: { id: viewerId }, select: { nbaTailing: true } });
  return viewer?.nbaTailing ? { ownerId: owner.id, isSelf: false } : null;
}

const keyOf = (b: { tipster: string; pick: string; placedAt: string | Date }) => nbaDedupeKey(b.tipster, b.pick, new Date(b.placedAt));

/** The owner's NBA picks as `viewerId` sees them, or null if NBA tailing isn't on for them. */
export async function getNbaTail(prisma: PrismaClient, viewerId: string): Promise<NbaTail | null> {
  const a = await access(prisma, viewerId);
  if (!a) return null;
  const bets = (await listNbaBets(prisma, a.ownerId)).filter(shared);
  const openKeys = bets.filter((b) => b.result === "PENDING").map(keyOf);
  const mine = a.isSelf
    ? new Set(openKeys)
    : new Set((await prisma.nbaBet.findMany({ where: { userId: viewerId, dedupeKey: { in: openKeys } }, select: { dedupeKey: true } })).map((r) => r.dedupeKey));
  return {
    isSelf: a.isSelf,
    // Notes are the owner's own.
    bets: bets.map((b) => ({ ...b, notes: a.isSelf ? b.notes : null, copied: b.result === "PENDING" && mine.has(keyOf(b)) })),
  };
}

interface CopyResult {
  copied: number;
  skipped: number;
}

/** Copy the owner's open NBA picks (all, or the given ids) to your NBA page, with the same units and odds. */
export async function copyNbaBets(prisma: PrismaClient, viewerId: string, ids: string[] | null, now = new Date()): Promise<CopyResult> {
  const a = await access(prisma, viewerId);
  if (!a) throw new ServiceError("NBA tailing isn't turned on for your account.", 403, "forbidden");
  if (a.isSelf) throw new ServiceError("These are your own picks - they're already on your NBA page.", 400, "self");
  const source = (await prisma.nbaBet.findMany({ where: { userId: a.ownerId, result: "PENDING", ...(ids ? { id: { in: ids } } : {}) } })).filter(shared);
  const result: CopyResult = { copied: 0, skipped: 0 };
  for (const b of source) {
    try {
      await createNbaBet(
        prisma,
        viewerId,
        {
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
          dateKind: b.dateKind === "POSTED" ? "POSTED" : "GAME",
          result: "PENDING",
          notes: null,
        },
        now,
      );
      result.copied++;
    } catch (err) {
      if (err instanceof ServiceError && err.status === 409) result.skipped++;
      else throw err;
    }
  }
  return result;
}
