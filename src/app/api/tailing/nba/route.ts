import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth/current";
import { handle, parseJson } from "@/lib/api";
import { copyNbaBets, getNbaTail } from "@/lib/nba/tailing";

/** The owner's NBA picks (null when NBA tailing isn't on for you). */
export const GET = handle(async () => NextResponse.json({ nba: await getNbaTail(db(), await requireUserId()) }));

const schema = z.object({
  /** Picks to copy; omit to copy all open picks. */
  ids: z.array(z.string().min(1).max(40)).max(200).optional(),
});

/** Copy the owner's open NBA picks to your NBA page. */
export const POST = handle(async (request: Request) => {
  const { ids } = await parseJson(request, schema);
  const userId = await requireUserId();
  const result = await copyNbaBets(db(), userId, ids ?? null);
  return NextResponse.json({ ...result, nba: await getNbaTail(db(), userId) });
});
