import { Suspense } from "react";
import { LoginForm } from "@/components/LoginForm";

export const metadata = { title: "Log in - TT Alarms" };

export default function LoginPage() {
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
