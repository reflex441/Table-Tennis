import type { PrismaClient, User } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { ServiceError } from "@/lib/alarms/service-error";
import { dummyPasswordHash, hashPassword, verifyPassword } from "./password";

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  hasPassword: boolean;
  hasGoogle: boolean;
  /** Profile picture URL (versioned), or null for initials. */
  avatarUrl: string | null;
  /** Finished (or skipped) the first-run tutorial. */
  onboarded: boolean;
}

/** Fields needed for PublicUser (never loads the picture bytes). */
export const publicUserSelect = { id: true, email: true, name: true, passwordHash: true, googleId: true, avatarUpdatedAt: true, onboardedAt: true } as const;

type PublicUserSource = Pick<User, "id" | "email" | "name" | "passwordHash" | "googleId" | "avatarUpdatedAt" | "onboardedAt">;

export function avatarUrl(u: { id: string; avatarUpdatedAt: Date | null }): string | null {
  return u.avatarUpdatedAt ? `/api/users/${u.id}/avatar?v=${u.avatarUpdatedAt.getTime()}` : null;
}

export function toPublicUser(u: PublicUserSource): PublicUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    hasPassword: Boolean(u.passwordHash),
    hasGoogle: Boolean(u.googleId),
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

export async function registerUser(prisma: PrismaClient, input: { email: string; name: string; password: string }, now = new Date()): Promise<User> {
  const email = normalizeEmail(input.email);
  const passwordHash = await hashPassword(input.password);
  let user: User;
  try {
    user = await prisma.user.create({ data: { email, name: input.name.trim(), passwordHash, lastLoginAt: now } });
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
 * Sign in with Google: the account linked to this Google id, else the account
 * with the same (Google-verified) email, which gets linked; else a new account.
 */
export async function signInWithGoogle(
  prisma: PrismaClient,
  profile: { sub: string; email: string; emailVerified: boolean; name: string | null },
  now = new Date(),
): Promise<User> {
  const linked = await prisma.user.findUnique({ where: { googleId: profile.sub } });
  if (linked) return prisma.user.update({ where: { id: linked.id }, data: { lastLoginAt: now } });
  if (!profile.emailVerified) throw new ServiceError("Your Google email address is not verified.", 403, "email_unverified");
  const email = normalizeEmail(profile.email);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return prisma.user.update({ where: { id: existing.id }, data: { googleId: profile.sub, lastLoginAt: now } });
  }
  const user = await prisma.user.create({
    data: { email, name: (profile.name || email.split("@")[0]).slice(0, 40), googleId: profile.sub, lastLoginAt: now },
  });
  await claimOrphanData(prisma, user.id);
  return user;
}
