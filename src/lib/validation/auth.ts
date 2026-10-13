import { z } from "zod";

const emailSchema = z.string().trim().max(200).pipe(z.email("Enter a valid email address"));
const passwordSchema = z.string().min(8, "Use at least 8 characters").max(200, "Too long");

const displayNameSchema = z.string().trim().min(1, "Enter a display name").max(40, "At most 40 characters");

export const updateProfileSchema = z.object({ name: displayNameSchema });

export const registerSchema = z.object({
  name: displayNameSchema,
  email: emailSchema,
  password: passwordSchema,
  /** One-time key from the owner (not needed for the very first account). */
  inviteKey: z.string().trim().max(40).nullish(),
});

export const setPasswordSchema = z.object({
  currentPassword: z.string().max(200).nullish(),
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: z.string().trim().min(1, "Enter your email").max(200),
  password: z.string().min(1, "Enter your password").max(200),
});

/** Only same-site relative paths are allowed as a post-login destination. */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}
