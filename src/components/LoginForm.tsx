"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Loader2, LogIn, UserPlus } from "lucide-react";


/** Sign in, or create an account with an invite key from the owner. */
export function LoginForm({ mode, inviteRequired = true }: { mode: "login" | "signup"; inviteRequired?: boolean }) {
  const params = useSearchParams();
  const nextParam = params.get("next");
  const next = nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [inviteKey, setInviteKey] = useState(() => params.get("key") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signup = mode === "signup";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (signup && password !== confirm) return setError("The passwords don't match.");
    setBusy(true);
    try {
      const res = await fetch(signup ? "/api/auth/register" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signup ? { name, email, password, inviteKey: inviteKey.trim() || null } : { email, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(body?.error?.message ?? "Something went wrong. Please try again.");
        return;
      }
      window.location.replace(next);
    } finally {
      setBusy(false);
    }
  };

  const qs = nextParam ? `?next=${encodeURIComponent(next)}` : "";
  return (
    <div className="card w-full max-w-sm p-5">
      <div className="mb-1 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent/15 text-accent">🏓</span>
        <h1 className="text-lg font-semibold">TT Alarms</h1>
      </div>
      <p className="mb-4 text-sm text-muted">{signup ? "Create your account" : "Sign in to your account"}</p>

      <form onSubmit={submit} className="flex flex-col gap-3">
        {signup && inviteRequired && (
          <label>
            <span className="label">Invite key</span>
            <input
              className="input font-mono uppercase tracking-wider"
              aria-label="Invite key"
              placeholder="TT-XXXX-XXXX-XXXX"
              value={inviteKey}
              onChange={(e) => setInviteKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              required
              autoFocus
            />
            <span className="mt-1 block text-[11px] text-muted">Ask the owner for one - each key works once.</span>
          </label>
        )}
        {signup && (
          <label>
            <span className="label">Display name</span>
            <input className="input" aria-label="Display name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="nickname" required />
            <span className="mt-1 block text-[11px] text-muted">Shown on the leaderboard. Your email is never shown.</span>
          </label>
        )}
        <label>
          <span className="label">Email</span>
          <input type="email" className="input" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required autoFocus={!signup} />
        </label>
        <label>
          <span className="label">Password</span>
          <input
            type="password"
            className="input"
            aria-label="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={signup ? "new-password" : "current-password"}
            minLength={signup ? 8 : undefined}
            required
          />
          {signup && <span className="mt-1 block text-[11px] text-muted">At least 8 characters.</span>}
        </label>
        {signup && (
          <label>
            <span className="label">Confirm password</span>
            <input type="password" className="input" aria-label="Confirm password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
          </label>
        )}
        {error && <p className="text-sm text-under" role="alert">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : signup ? <UserPlus className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
          {signup ? "Create account" : "Sign in"}
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-muted">
        {signup ? (
          <>
            Already have an account?{" "}
            <Link href={`/login${qs}`} className="text-accent hover:underline">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link href={`/signup${qs}`} className="text-accent hover:underline">
              Create an account
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
