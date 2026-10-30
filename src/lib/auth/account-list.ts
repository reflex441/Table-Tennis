import type { PrismaClient } from "@/generated/prisma/client";
import { ServiceError } from "@/lib/alarms/service-error";
import { isOwner } from "./invites";

/** One registered account, for the owner's Settings → Accounts list. */
export interface AccountDTO {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  lastLoginAt: string | null;
  /** Last time they used the site (signed in), at most 10 minutes out. */
  lastSeenAt: string | null;
  /** Used the site in the last 15 minutes. */
  online: boolean;
  /** Table tennis bets recorded. */
  bets: number;
  nbaBets: number;
  /** Can see and copy the owner's NBA picks on the Tailing page. */
  nbaTailing: boolean;
  /** The owner (the account everyone tails). */
  isOwner: boolean;
}

async function requireOwner(prisma: PrismaClient, userId: string): Promise<void> {
  if (!(await isOwner(prisma, userId))) throw new ServiceError("Only the owner can see the accounts.", 403, "forbidden");
}

/** Every registered account, newest first (owner only). */
export async function listAccounts(prisma: PrismaClient, viewerId: string, now = new Date()): Promise<AccountDTO[]> {
  await requireOwner(prisma, viewerId);
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    take: 1000,
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      lastLoginAt: true,
      lastSeenAt: true,
      nbaTailing: true,
      _count: { select: { matches: { where: { bet: { isNot: null } } }, nbaBets: true } },
    },
  });
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    createdAt: u.createdAt.toISOString(),
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
    // Visits are saved every 10 minutes.
    online: u.lastSeenAt !== null && now.getTime() - u.lastSeenAt.getTime() < 15 * 60_000,
    bets: u._count.matches,
    nbaBets: u._count.nbaBets,
    nbaTailing: u.nbaTailing,
    isOwner: u.id === viewerId,
  }));
}

/** Let an account see your NBA picks on the Tailing page, or stop it (owner only). */
export async function setNbaTailing(prisma: PrismaClient, viewerId: string, accountId: string, on: boolean): Promise<void> {
  await requireOwner(prisma, viewerId);
  const res = await prisma.user.updateMany({ where: { id: accountId }, data: { nbaTailing: on } });
  if (!res.count) throw new ServiceError("Account not found.", 404, "not_found");
}
