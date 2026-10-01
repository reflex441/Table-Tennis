import { connection } from "next/server";
import { requirePageUser } from "@/lib/auth/current";
import { NewMatch } from "@/components/NewMatch";

export const metadata = { title: "New match - TT Alarms" };

export default async function NewMatchPage() {
  await connection();
  await requirePageUser("/matches/new");
  return <NewMatch />;
}
