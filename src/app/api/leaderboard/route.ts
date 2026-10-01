import { NextResponse, connection } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth/current";
import { handle, jsonError } from "@/lib/api";
import { getLeaderboard } from "@/lib/leaderboard";

/** `?type=BOT|PERSONAL` limits the ranking to that play type. */
export const GET = handle(async (request: Request) => {
  await connection();
  const userId = await requireUserId();
  const type = new URL(request.url).searchParams.get("type");
  if (type && type !== "BOT" && type !== "PERSONAL") return jsonError(422, "validation_error", "type must be BOT or PERSONAL");
  return NextResponse.json(await getLeaderboard(db(), { currentUserId: userId, playType: type === "BOT" || type === "PERSONAL" ? type : undefined }));
});
