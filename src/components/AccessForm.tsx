"use client";

import { useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";

/** "Enter access code" - shown before anything else when the site has a code. */
export function AccessForm({ next }: { next: string }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/access", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(body?.error?.message ?? "That code isn't right.");
        return;
      }
      // Full navigation so the new cookie is used for everything.
      window.location.assign(next);
    } catch {
      setError("Couldn't check the code. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center px-4 py-8">
      <form onSubmit={submit} className="card w-full max-w-sm p-5">
        <div className="mb-1 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent/15 text-accent">🏓</span>
          <h1 className="text-lg font-semibold">TT Alarms</h1>
        </div>
        <p className="mb-4 text-sm text-muted">This app is private. Enter the access code to continue.</p>
        <label>
          <span className="label">Access code</span>
          <input
            className="input"
            type="password"
            autoComplete="off"
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-label="Access code"
          />
        </label>
        {error && <p className="mt-2 text-sm text-under">{error}</p>}
        <button type="submit" className="btn-primary mt-4 w-full" disabled={busy || !code.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} Continue
        </button>
        <p className="mt-3 text-xs text-muted">Don&apos;t have the code? Ask the person who invited you.</p>
      </form>
    </div>
  );
}
