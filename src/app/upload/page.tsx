import { connection } from "next/server";
import { requirePageUser } from "@/lib/auth/current";
import { UploadReview } from "@/components/upload/UploadReview";

export const metadata = { title: "Upload screenshots - TT Alarms" };

export default async function UploadPage() {
  await connection();
  await requirePageUser("/upload");
  return <UploadReview />;
}
