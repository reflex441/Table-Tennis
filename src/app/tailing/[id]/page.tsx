import { redirect } from "next/navigation";

/** Old per-account links now open that account's profit page. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  redirect(`/users/${(await params).id}`);
}
