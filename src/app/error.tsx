"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card mx-auto mt-10 max-w-md p-6 text-center">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="mt-1 text-sm text-muted">{error.message || "Unexpected error."}</p>
      <button className="btn-primary mt-4" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
