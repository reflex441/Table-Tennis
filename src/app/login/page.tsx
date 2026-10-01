import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { LoginForm } from "@/components/LoginForm";
import { getCurrentUser } from "@/lib/auth/current";
import { googleConfigured } from "@/lib/auth/google";

export const metadata = { title: "Sign in - TT Alarms" };

export default async function Page() {
  await connection();
  if (await getCurrentUser().catch(() => null)) redirect("/");
  return (
    <div className="grid min-h-screen place-items-center px-4 py-8">
      <Suspense>
        <LoginForm mode="login" googleEnabled={googleConfigured()} />
      </Suspense>
    </div>
  );
}
