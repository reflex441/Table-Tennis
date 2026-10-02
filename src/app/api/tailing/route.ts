import { NextResponse, connection } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth/current";
import { handle } from "@/lib/api";
import { getTailProfile } from "@/lib/tailing";

/** The tailed account's profit data and upcoming bets. */
export const GET = handle(async () => {
  await connection();
  return NextResponse.json({ profile: await getTailProfile(db(), await requireUserId()) });
});
