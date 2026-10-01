import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth/current";
import { handle, jsonError, parseJson } from "@/lib/api";

const schema = z.object({ deviceType: z.enum(["desktop", "mobile"]) });

/** Switch a device between "computer" (rings until confirmed) and "phone" (one notification). */
export const PATCH = handle(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { deviceType } = await parseJson(request, schema);
  const res = await db().pushSubscription.updateMany({ where: { id, userId: await requireUserId() }, data: { deviceType } });
  if (!res.count) return jsonError(404, "not_found", "Device not found.");
  return NextResponse.json({ ok: true });
});
