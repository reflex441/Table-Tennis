/** Basketball icon in the style of the lucide icons (stroke = currentColor). */
export function BasketballIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2v20" />
      <path d="M5 4.9a10 10 0 0 1 0 14.2" />
      <path d="M19 4.9a10 10 0 0 0 0 14.2" />
    </svg>
  );
}
