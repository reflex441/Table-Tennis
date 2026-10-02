import { NextResponse } from "next/server";
import { connection } from "next/server";
import { env, vapidKeyProblem } from "@/lib/env";
import { handle } from "@/lib/api";

/** Public VAPID key (served at runtime so it doesn't need to be baked into the build). */
export const GET = handle(async () => {
  await connection();
  const e = env();
  // Keys are tidied in env(); anything still wrong is explained to the user.
  const problem = vapidKeyProblem(e.VAPID_PUBLIC_KEY, e.VAPID_PRIVATE_KEY);
  return NextResponse.json({ configured: !problem, publicKey: problem ? null : e.VAPID_PUBLIC_KEY, problem });
});
