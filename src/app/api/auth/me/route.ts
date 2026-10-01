import { NextResponse, connection } from "next/server";
import { db } from "@/lib/db";
import { handle, parseJson } from "@/lib/api";
import { getCurrentUser, requireUserId } from "@/lib/auth/current";
import { toPublicUser, updateDisplayName } from "@/lib/auth/accounts";
import { updateProfileSchema } from "@/lib/validation/auth";

export const GET = handle(async () => {
  await connection();
  return NextResponse.json({ user: await getCurrentUser() });
});

/** Change your display name. */
export const PATCH = handle(async (request: Request) => {
  const userId = await requireUserId();
  const { name } = await parseJson(request, updateProfileSchema);
  return NextResponse.json({ user: toPublicUser(await updateDisplayName(db(), userId, name)) });
});
