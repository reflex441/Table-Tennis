import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card mx-auto mt-10 max-w-md p-6 text-center">
      <h1 className="text-lg font-semibold">Not found</h1>
      <p className="mt-1 text-sm text-muted">This match or page doesn&apos;t exist (it may have been deleted).</p>
      <Link href="/" className="btn-primary mt-4">
        Back to dashboard
      </Link>
    </div>
  );
}
