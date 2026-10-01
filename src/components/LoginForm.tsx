"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Loader2, Lock } from "lucide-react";

export function LoginForm() {
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    setBusy(false);
    if (!res.ok) {
      setError("Incorrect password.");
      return;
    }
    const next = params.get("next");
    window.location.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
  };

  return (
    <form onSubmit={submit} className="card w-full max-w-sm p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent/15 text-accent">🏓</span>
        <h1 className="text-lg font-semibold">TT Alarms</h1>
      </div>
      <label className="block">
        <span className="label">Password</span>
        <input type="password" className="input" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error && <p className="mt-2 text-sm text-under">{error}</p>}
      <button className="btn-primary mt-4 w-full" disabled={busy || !password}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />} Log in
      </button>
    </form>
  );
}
