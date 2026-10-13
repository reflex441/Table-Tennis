import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth/current";
import { handle } from "@/lib/api";
import { deleteInvite } from "@/lib/auth/invites";

type Ctx = { params: Promise<{ id: string }> };

/** Cancel an unused invite key. */
export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  await deleteInvite(db(), await requireUserId(), id);
  return new NextResponse(null, { status: 204 });
});
