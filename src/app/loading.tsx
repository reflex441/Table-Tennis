/**
 * Shown instantly on navigation while the next page loads on the server,
 * so clicks feel immediate (the nav bar stays in place).
 */
export default function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-4" role="status" aria-label="Loading">
      <div className="h-7 w-48 rounded-md bg-panel-2" />
      <div className="h-24 rounded-xl border border-line bg-panel" />
      <div className="h-40 rounded-xl border border-line bg-panel" />
      <div className="h-40 rounded-xl border border-line bg-panel" />
    </div>
  );
}
