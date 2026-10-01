import { NextResponse, connection } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth/current";
import { handle } from "@/lib/api";
import { listTailing } from "@/lib/tailing";

/** Accounts you tail and accounts you could tail. */
export const GET = handle(async () => {
  await connection();
  return NextResponse.json(await listTailing(db(), await requireUserId()));
});
