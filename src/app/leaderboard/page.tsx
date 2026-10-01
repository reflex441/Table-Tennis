import { connection } from "next/server";
import { requirePageUser } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { getLeaderboard } from "@/lib/leaderboard";
import { LeaderboardPage } from "@/components/LeaderboardPage";

export const metadata = { title: "Leaderboard - TT Alarms" };

export default async function Page() {
  await connection();
  const user = await requirePageUser("/leaderboard");
  const prisma = db();
  const [all, bot, personal] = await Promise.all([
    getLeaderboard(prisma, { currentUserId: user.id }),
    getLeaderboard(prisma, { currentUserId: user.id, playType: "BOT" }),
    getLeaderboard(prisma, { currentUserId: user.id, playType: "PERSONAL" }),
  ]);
  return <LeaderboardPage boards={{ ALL: all, BOT: bot, PERSONAL: personal }} currentUserId={user.id} />;
}
