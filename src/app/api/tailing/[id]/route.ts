import { NextResponse, connection } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth/current";
import { handle } from "@/lib/api";
import { getTailProfile, tail, untail } from "@/lib/tailing";

type Ctx = { params: Promise<{ id: string }> };

/** Their profit page data and upcoming bets. */
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  await connection();
  const { id } = await ctx.params;
  return NextResponse.json(await getTailProfile(db(), await requireUserId(), id));
});

/** Start tailing this account. */
export const POST = handle(async (_request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  await tail(db(), await requireUserId(), id);
  return NextResponse.json({ tailed: true });
});

/** Stop tailing this account. */
export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  await untail(db(), await requireUserId(), id);
  return NextResponse.json({ tailed: false });
});
