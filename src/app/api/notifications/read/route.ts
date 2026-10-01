import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handle, parseJson } from "@/lib/api";

const schema = z.object({ ids: z.array(z.string().min(1)).max(100).optional(), all: z.boolean().optional() });

export const POST = handle(async (request: Request) => {
  const { ids, all } = await parseJson(request, schema);
  const where = all ? { readAt: null } : { id: { in: ids ?? [] }, readAt: null };
  const res = await db().inAppNotification.updateMany({ where, data: { readAt: new Date() } });
  return NextResponse.json({ updated: res.count });
});
