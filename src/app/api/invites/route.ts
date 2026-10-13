import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth/current";
import { handle } from "@/lib/api";
import { createInvite, listInvites } from "@/lib/auth/invites";

/** The owner's invite keys (used and unused). */
export const GET = handle(async () => NextResponse.json({ invites: await listInvites(db(), await requireUserId()) }));

/** Make a new one-time invite key. */
export const POST = handle(async () => NextResponse.json({ invite: await createInvite(db(), await requireUserId()) }, { status: 201 }));
