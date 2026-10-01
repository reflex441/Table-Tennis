import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { requirePageUser } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { getTailProfile, type TailProfile } from "@/lib/tailing";
import { ServiceError } from "@/lib/alarms/service-error";
import { TailProfilePage } from "@/components/TailProfilePage";

export const metadata = { title: "Tailing - TT Alarms" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const user = await requirePageUser(`/tailing/${id}`);
  if (id === user.id) redirect("/profit");
  let profile: TailProfile;
  try {
    profile = await getTailProfile(db(), user.id, id);
  } catch (err) {
    if (!(err instanceof ServiceError)) throw err;
    return (
      <div className="card mx-auto max-w-md p-6 text-center">
        <p className="text-sm text-muted">This account isn&apos;t available to tail (it may have turned tailing off).</p>
        <Link href="/tailing" className="btn-ghost mt-3">
          Back to Tailing
        </Link>
      </div>
    );
  }
  return <TailProfilePage initial={profile} />;
}
