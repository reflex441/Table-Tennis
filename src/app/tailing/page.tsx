import { connection } from "next/server";
import { requirePageUser } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { getTailProfile } from "@/lib/tailing";
import { TailProfilePage } from "@/components/TailProfilePage";

export const metadata = { title: "Tailing - TT Alarms" };

export default async function Page() {
  await connection();
  const user = await requirePageUser("/tailing");
  const profile = await getTailProfile(db(), user.id);
  if (!profile) return <p className="card px-4 py-10 text-center text-sm text-muted">Nothing to tail yet.</p>;
  return <TailProfilePage initial={profile} />;
}
