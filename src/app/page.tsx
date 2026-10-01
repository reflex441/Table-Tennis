import { connection } from "next/server";
import { Dashboard } from "@/components/Dashboard";
import { db } from "@/lib/db";
import { listMatches } from "@/lib/alarms/queries";
import type { MatchDTO } from "@/lib/types";

export default async function HomePage() {
  await connection();
  let matches: MatchDTO[] = [];
  try {
    matches = await listMatches(db(), null);
  } catch (err) {
    console.error("Failed to load matches", err);
  }
  return <Dashboard initial={matches} />;
}
