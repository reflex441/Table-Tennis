import type { PrismaClient } from "@/generated/prisma/client";
import { ServiceError } from "@/lib/alarms/service-error";
import { getTailedAccount } from "@/lib/tailing";
import { newInviteCode } from "./invite-code";

/**
 * Invite keys: a new account needs one (except the very first account), and
 * each key works once. Only the owner (the account everyone tails) makes them.
 */

export interface InviteDTO {
  id: string;
  code: string;
  createdAt: string;
  usedAt: string | null;
  /** Display name of who used it. */
  usedBy: string | null;
}

export async function isOwner(prisma: PrismaClient, userId: string): Promise<boolean> {
  return (await getTailedAccount(prisma))?.id === userId;
}

async function requireOwner(prisma: PrismaClient, userId: string): Promise<void> {
  if (!(await isOwner(prisma, userId))) throw new ServiceError("Only the owner can manage invite keys.", 403, "forbidden");
}

export async function listInvites(prisma: PrismaClient, userId: string): Promise<InviteDTO[]> {
  await requireOwner(prisma, userId);
  const keys = await prisma.inviteKey.findMany({ orderBy: { createdAt: "desc" }, include: { usedBy: { select: { name: true } } }, take: 500 });
  return keys.map((k) => ({
    id: k.id,
    code: k.code,
    createdAt: k.createdAt.toISOString(),
    usedAt: k.usedAt?.toISOString() ?? null,
    usedBy: k.usedBy?.name ?? (k.usedAt ? "(deleted account)" : null),
  }));
}

export async function createInvite(prisma: PrismaClient, userId: string): Promise<InviteDTO> {
  await requireOwner(prisma, userId);
  const key = await prisma.inviteKey.create({ data: { code: newInviteCode(), createdById: userId } });
  return { id: key.id, code: key.code, createdAt: key.createdAt.toISOString(), usedAt: null, usedBy: null };
}

/** Cancel a key that hasn't been used. */
export async function deleteInvite(prisma: PrismaClient, userId: string, id: string): Promise<void> {
  await requireOwner(prisma, userId);
  const { count } = await prisma.inviteKey.deleteMany({ where: { id, usedAt: null } });
  if (!count) throw new ServiceError("That key has already been used (or doesn't exist).", 409, "invite_used");
}
