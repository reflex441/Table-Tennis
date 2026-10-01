/** Round profile picture, or initials when there is none. */
export function Avatar({ name, url, size = 32, className = "" }: { name: string; url: string | null | undefined; size?: number; className?: string }) {
  const initials =
    name
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?";
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.36)) };
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" width={size} height={size} style={style} className={`shrink-0 rounded-full border border-line object-cover ${className}`} />;
  }
  return (
    <span aria-hidden="true" style={style} className={`grid shrink-0 place-items-center rounded-full bg-accent/15 font-bold text-accent ${className}`}>
      {initials}
    </span>
  );
}
