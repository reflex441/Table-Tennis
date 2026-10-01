"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Loader2, LogIn, UserPlus } from "lucide-react";

const ERRORS: Record<string, string> = {
  google_not_configured: "Google sign-in isn't set up yet: put the real Client ID and Client secret from Google Cloud Console in .env and restart.",
  google_cancelled: "Google sign-in was cancelled.",
  google_state: "Google sign-in expired or was started in another tab. Please try again.",
  google_failed: "Google sign-in failed. Please try again.",
  email_unverified: "Your Google email address isn't verified.",
};

/** Sign in or create an account (email + password, or Google). */
export function LoginForm({ mode, googleEnabled }: { mode: "login" | "signup"; googleEnabled: boolean }) {
  const params = useSearchParams();
  const nextParam = params.get("next");
  const next = nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(() => ERRORS[params.get("error") ?? ""] ?? null);
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
        body: JSON.stringify(signup ? { name, email, password } : { email, password }),
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

      {googleEnabled && (
        <>
          <a href={`/api/auth/google${qs}`} className="btn w-full border border-line bg-white py-2 font-semibold text-slate-900 hover:bg-slate-100">
            <GoogleLogo /> Continue with Google
          </a>
          <div className="my-4 flex items-center gap-3 text-[11px] uppercase tracking-wide text-muted">
            <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
          </div>
        </>
      )}

      <form onSubmit={submit} className="flex flex-col gap-3">
        {signup && (
          <label>
            <span className="label">Display name</span>
            <input className="input" aria-label="Display name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="nickname" required />
            <span className="mt-1 block text-[11px] text-muted">Shown on the leaderboard. Your email is never shown.</span>
          </label>
        )}
        <label>
          <span className="label">Email</span>
          <input type="email" className="input" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required autoFocus={!googleEnabled} />
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

function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" className="h-4 w-4" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
