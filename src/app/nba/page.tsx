import { connection } from "next/server";
import { requirePageUser } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { listNbaBets } from "@/lib/nba/service";
import { listBetRows } from "@/lib/bets/queries";
import { NbaPage } from "@/components/nba/NbaPage";

export const metadata = { title: "NBA - TT Alarms" };

export default async function Page() {
  await connection();
  const user = await requirePageUser("/nba");
  const [bets, tt] = await Promise.all([listNbaBets(db(), user.id), listBetRows(db(), user.id)]);
  // Only what the combined totals need from the table tennis bets.
  const tableTennis = tt.map((r) => ({ stake: r.stake, odds: r.odds, result: r.result, profit: r.profit, startsAt: r.startsAt }));
  return <NbaPage initial={bets} tableTennis={tableTennis} />;
}
