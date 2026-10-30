import { cache } from "react";
import { cookies } from "next/headers";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { ServiceError } from "@/lib/alarms/service-error";
import { SESSION_COOKIE, getSessionSecret, verifySessionToken } from "./session";
import { publicUserSelect, toPublicUser, type PublicUser } from "./accounts";
import { recordVisit } from "./last-seen";

/** The signed-in user (verified against the database), or null. Looked up once per request; also notes the visit. */
export const getCurrentUser = cache(async (): Promise<PublicUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const prisma = db();
  const userId = verifySessionToken(token, await getSessionSecret(prisma));
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: publicUserSelect });
  if (!user) return null;
  // Last visit (owner's Settings → Accounts), saved after the response.
  const visit = () => recordVisit(prisma, user.id).catch((err) => console.error("[last seen]", err));
  try {
    after(visit);
  } catch {
    void visit();
  }
  return toPublicUser(user);
});

/** For API routes: the signed-in user's id, or a 401 error. */
export async function requireUserId(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) throw new ServiceError("Sign in required.", 401, "unauthorized");
  return user.id;
}

/** For pages: the signed-in user, or a redirect to the sign-in page. */
export async function requirePageUser(next = "/"): Promise<PublicUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return user;
}
