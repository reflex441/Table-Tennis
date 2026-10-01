import { NextResponse, connection } from "next/server";
import { handle } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth/current";

export const GET = handle(async () => {
  await connection();
  return NextResponse.json({ user: await getCurrentUser() });
});
