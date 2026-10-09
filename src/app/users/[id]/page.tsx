import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { requirePageUser } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { getPublicProfile } from "@/lib/profiles";
import { getTailedAccount } from "@/lib/tailing";
import { UserProfilePage } from "@/components/UserProfilePage";

export const metadata = { title: "Profit - TT Alarms" };

/** Someone's profit page (read-only), opened by clicking their name on the leaderboard. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const user = await requirePageUser(`/users/${id}`);
  if (id === user.id) redirect("/profit");
  // The account everyone tails has its own page, with the bets you can copy.
  if (id === (await getTailedAccount(db()))?.id) redirect("/tailing");
  const profile = await getPublicProfile(db(), id);
  if (!profile) notFound();
  return <UserProfilePage profile={profile} />;
}
