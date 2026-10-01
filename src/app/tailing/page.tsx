import { connection } from "next/server";
import { requirePageUser } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { listTailing } from "@/lib/tailing";
import { TailingPage } from "@/components/TailingPage";

export const metadata = { title: "Tailing - TT Alarms" };

export default async function Page() {
  await connection();
  const user = await requirePageUser("/tailing");
  return <TailingPage initial={await listTailing(db(), user.id)} />;
}
