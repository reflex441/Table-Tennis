import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth/current";
import { handle } from "@/lib/api";
import { listAccounts } from "@/lib/auth/account-list";

/** Every registered account (owner only). */
export const GET = handle(async () => NextResponse.json({ accounts: await listAccounts(db(), await requireUserId()) }));
