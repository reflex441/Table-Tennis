import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { db } from "@/lib/db";
import { getMatch } from "@/lib/alarms/queries";
import { MatchDetail } from "@/components/MatchDetail";

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const match = await getMatch(db(), id);
  if (!match) notFound();
  return (
    <Suspense>
      <MatchDetail initial={match} />
    </Suspense>
  );
}
