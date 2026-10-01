import { NextResponse } from "next/server";
import { connection } from "next/server";
import { env } from "@/lib/env";
import { handle } from "@/lib/api";

/** Public VAPID key (served at runtime so it doesn't need to be baked into the build). */
export const GET = handle(async () => {
  await connection();
  const e = env();
  const configured = Boolean(e.VAPID_PUBLIC_KEY && e.VAPID_PRIVATE_KEY);
  return NextResponse.json({ configured, publicKey: configured ? e.VAPID_PUBLIC_KEY : null });
});
