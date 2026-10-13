import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handle, parseJson } from "@/lib/api";
import { requireUserId } from "@/lib/auth/current";

const schema = z.object({ done: z.boolean(), tutorial: z.enum(["main", "nba"]).default("main") });

/** Mark the first-run tutorial (or the NBA page's) as finished/skipped, or not, to show it again. */
export const POST = handle(async (request: Request) => {
  const userId = await requireUserId();
  const { done, tutorial } = await parseJson(request, schema);
  const at = done ? new Date() : null;
  await db().user.update({ where: { id: userId }, data: tutorial === "nba" ? { nbaOnboardedAt: at } : { onboardedAt: at } });
  return NextResponse.json({ ok: true });
});
