import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth/current";
import { handle, parseJson } from "@/lib/api";
import { copyBets } from "@/lib/tailing";
import { wakeScheduler } from "@/lib/scheduler/runner";

const schema = z.object({
  /** Bets to copy; omit to copy all their upcoming bets. */
  matchIds: z.array(z.string().min(1).max(40)).max(100).optional(),
});

/** Copy a tailed account's upcoming bets to your dashboard. */
export const POST = handle(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { matchIds } = await parseJson(request, schema);
  const result = await copyBets(db(), await requireUserId(), id, matchIds ?? null);
  if (result.copied) wakeScheduler();
  return NextResponse.json(result);
});
