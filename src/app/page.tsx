import { requirePageUser } from "@/lib/auth/current";
import { connection } from "next/server";
import { Dashboard } from "@/components/Dashboard";
import { db } from "@/lib/db";
import { listMatches } from "@/lib/alarms/queries";
import type { MatchDTO } from "@/lib/types";

export default async function HomePage() {
  await connection();
  const user = await requirePageUser("/");
  let matches: MatchDTO[] = [];
  try {
    matches = await listMatches(db(), user.id, null);
  } catch (err) {
    console.error("Failed to load matches", err);
  }
  return <Dashboard initial={matches} />;
}
