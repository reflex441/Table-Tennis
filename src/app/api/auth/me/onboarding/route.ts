import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handle, parseJson } from "@/lib/api";
import { requireUserId } from "@/lib/auth/current";

const schema = z.object({ done: z.boolean() });

/** Mark the first-run tutorial as finished/skipped (or not, to show it again). */
export const POST = handle(async (request: Request) => {
  const userId = await requireUserId();
  const { done } = await parseJson(request, schema);
  await db().user.update({ where: { id: userId }, data: { onboardedAt: done ? new Date() : null } });
  return NextResponse.json({ ok: true });
});
