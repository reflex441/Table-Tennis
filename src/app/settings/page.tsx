import { connection } from "next/server";
import { requirePageUser } from "@/lib/auth/current";
import { SettingsPage } from "@/components/SettingsPage";

export const metadata = { title: "Settings - TT Alarms" };

export default async function Page() {
  await connection();
  await requirePageUser("/settings");
  return <SettingsPage />;
}
