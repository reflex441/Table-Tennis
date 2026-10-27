import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth/current";
import { handle, parseJson } from "@/lib/api";
import { setNbaTailing } from "@/lib/auth/account-list";

const schema = z.object({ nbaTailing: z.boolean() });

/** Turn NBA tailing on or off for an account (owner only). */
export const PATCH = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { nbaTailing } = await parseJson(request, schema);
  await setNbaTailing(db(), await requireUserId(), (await params).id, nbaTailing);
  return NextResponse.json({ ok: true });
});
