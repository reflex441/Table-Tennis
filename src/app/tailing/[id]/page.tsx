import { redirect } from "next/navigation";

/** Old per-account links now go to the single Tailing page. */
export default function Page() {
  redirect("/tailing");
}
