import type { PrismaClient, User } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { ServiceError } from "@/lib/alarms/service-error";
import { dummyPasswordHash, hashPassword, verifyPassword } from "./password";
import { normalizeInviteCode } from "./invite-code";

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  hasPassword: boolean;
  /** Profile picture URL (versioned), or null for initials. */
  avatarUrl: string | null;
  /** Finished (or skipped) the first-run tutorial. */
  onboarded: boolean;
}

/** Fields needed for PublicUser (never loads the picture bytes). */
export const publicUserSelect = { id: true, email: true, name: true, passwordHash: true, avatarUpdatedAt: true, onboardedAt: true } as const;

type PublicUserSource = Pick<User, "id" | "email" | "name" | "passwordHash" | "avatarUpdatedAt" | "onboardedAt">;

export function avatarUrl(u: { id: string; avatarUpdatedAt: Date | null }): string | null {
  return u.avatarUpdatedAt ? `/api/users/${u.id}/avatar?v=${u.avatarUpdatedAt.getTime()}` : null;
}

export function toPublicUser(u: PublicUserSource): PublicUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    hasPassword: Boolean(u.passwordHash),
    avatarUrl: avatarUrl(u),
    onboarded: Boolean(u.onboardedAt),
  };
}

/** Change the display name shown in the app and on the leaderboard. */
export async function updateDisplayName(prisma: PrismaClient, userId: string, name: string): Promise<User> {
  return prisma.user.update({ where: { id: userId }, data: { name: name.trim() } });
}

/** Largest accepted profile picture (the browser resizes to 256x256 first). */
export const MAX_AVATAR_BYTES = 512 * 1024;

export async function setAvatar(prisma: PrismaClient, userId: string, image: { data: Buffer; mime: string } | null, now = new Date()) {
  return prisma.user.update({
    where: { id: userId },
    data: image ? { avatar: new Uint8Array(image.data), avatarMime: image.mime, avatarUpdatedAt: now } : { avatar: null, avatarMime: null, avatarUpdatedAt: null },
    select: publicUserSelect,
  });
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/**
 * Data created before accounts existed has no owner. The first account to be
 * created takes it over, so an existing install keeps its matches and bets.
 */
async function claimOrphanData(prisma: PrismaClient, userId: string): Promise<void> {
  if ((await prisma.user.count()) !== 1) return;
  await prisma.$transaction([
    prisma.match.updateMany({ where: { userId: null }, data: { userId } }),
    prisma.screenshot.updateMany({ where: { userId: null }, data: { userId } }),
    prisma.pushSubscription.updateMany({ where: { userId: null }, data: { userId } }),
    prisma.inAppNotification.updateMany({ where: { userId: null }, data: { userId } }),
    prisma.settings.updateMany({ where: { userId: null }, data: { userId } }),
  ]);
}

/**
 * Create an account with email + password. Needs an unused invite key (except
 * the very first account); the key is used up in the same step, so it can't
 * be used twice and isn't lost if this fails. An account from the old Google
 * sign-in (same email, no password yet) gets this password instead, keeping
 * everything in it.
 */
export async function registerUser(
  prisma: PrismaClient,
  input: { email: string; name: string; password: string; inviteKey?: string | null },
  now = new Date(),
): Promise<User> {
  const email = normalizeEmail(input.email);
  const code = input.inviteKey?.trim() ? normalizeInviteCode(input.inviteKey) : null;
  const firstAccount = (await prisma.user.count()) === 0;
  if (!firstAccount && !code) throw new ServiceError("Enter your invite key - ask the owner for one.", 403, "invite_required");
  const passwordHash = await hashPassword(input.password);
  let user: User;
  try {
    user = await prisma.$transaction(async (tx) => {
      if (code) {
        const claimed = await tx.inviteKey.updateMany({ where: { code, usedAt: null }, data: { usedAt: now } });
        if (claimed.count !== 1) throw new ServiceError("That invite key isn't valid or has already been used.", 403, "invite_invalid");
      }
      const existing = await tx.user.findUnique({ where: { email } });
      if (existing?.passwordHash) throw new ServiceError("An account with this email already exists. Sign in instead.", 409, "email_taken");
      const made = existing
        ? await tx.user.update({ where: { id: existing.id }, data: { passwordHash, lastLoginAt: now } })
        : await tx.user.create({ data: { email, name: input.name.trim(), passwordHash, lastLoginAt: now } });
      if (code) await tx.inviteKey.update({ where: { code }, data: { usedById: made.id } });
      return made;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ServiceError("An account with this email already exists. Sign in instead.", 409, "email_taken");
    }
    throw err;
  }
  await claimOrphanData(prisma, user.id);
  return user;
}

/** The user for an email + password, or null. Takes the same time whether or not the account exists. */
export async function authenticate(prisma: PrismaClient, emailRaw: string, password: string, now = new Date()): Promise<User | null> {
  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(emailRaw) } });
  const ok = await verifyPassword(password, user?.passwordHash ?? (await dummyPasswordHash()));
  if (!user || !user.passwordHash || !ok) return null;
  return prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: now } });
}

/**
 * Set or change the password: changing one needs the current password; an
 * account without one (made with the old Google sign-in) just sets it.
 */
export async function setPassword(prisma: PrismaClient, userId: string, input: { currentPassword?: string | null; password: string }): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } });
  if (user.passwordHash && !(await verifyPassword(input.currentPassword ?? "", user.passwordHash))) {
    throw new ServiceError("Your current password is wrong.", 403, "wrong_password");
  }
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(input.password) } });
}
