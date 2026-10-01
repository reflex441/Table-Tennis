import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth/current";
import { handle, jsonError } from "@/lib/api";

/** Delete one of your notifications. */
export const DELETE = handle(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const res = await db().inAppNotification.deleteMany({ where: { id, userId: await requireUserId() } });
  if (!res.count) return jsonError(404, "not_found", "Notification not found.");
  return new NextResponse(null, { status: 204 });
});
