import { AccessForm } from "@/components/AccessForm";

export const metadata = { title: "Access code - TT Alarms" };

/** First screen when the site has an access code (ACCESS_CODE). */
export default async function AccessPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  // Only same-site paths.
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return <AccessForm next={target} />;
}
