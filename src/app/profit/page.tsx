import { connection } from "next/server";
import { db } from "@/lib/db";
import { listBetRows, type BetRowWithMatch } from "@/lib/bets/queries";
import { ProfitPage } from "@/components/ProfitPage";

export const metadata = { title: "Profit - TT Alarms" };

export default async function Page() {
  await connection();
  let rows: BetRowWithMatch[] = [];
  try {
    rows = await listBetRows(db());
  } catch (err) {
    console.error("Failed to load bets", err);
  }
  return <ProfitPage initial={rows} />;
}
