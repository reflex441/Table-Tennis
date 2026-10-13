import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth/current";
import { handle } from "@/lib/api";
import { gradePendingNbaBets } from "@/lib/nba/grading-service";
import { listNbaBets } from "@/lib/nba/service";

export const maxDuration = 60;

/** "Check results": look up your pending NBA bets on ESPN now. */
export const POST = handle(async () => {
  const userId = await requireUserId();
  const report = await gradePendingNbaBets(db(), { userId, force: true, budgetMs: 40_000 });
  return NextResponse.json({ report, bets: await listNbaBets(db(), userId) });
});
