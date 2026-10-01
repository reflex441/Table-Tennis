import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth/current";
import { handle, parseJson } from "@/lib/api";

const schema = z.object({ ids: z.array(z.string().min(1)).max(100).optional(), all: z.boolean().optional() });

export const POST = handle(async (request: Request) => {
  const { ids, all } = await parseJson(request, schema);
  const userId = await requireUserId();
  const where = all ? { userId, readAt: null } : { userId, id: { in: ids ?? [] }, readAt: null };
  const res = await db().inAppNotification.updateMany({ where, data: { readAt: new Date() } });
  return NextResponse.json({ updated: res.count });
});
