import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handle } from "@/lib/api";
import { requireUserId } from "@/lib/auth/current";
import { pastBetSuggestions } from "@/lib/bets/past-games-query";

/** Players and recent past games for "Add past bet" to suggest as you type (loaded once per form). */
export const GET = handle(async () => {
  const userId = await requireUserId();
  return NextResponse.json(await pastBetSuggestions(db(), userId));
});
