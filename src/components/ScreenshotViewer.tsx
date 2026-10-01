"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

/** Full-screen view of a match's source screenshot(s). Esc / click outside closes. */
export function ScreenshotViewer({ ids, onClose, title, start = 0 }: { ids: string[]; onClose: () => void; title?: string; start?: number }) {
  const [index, setIndex] = useState(Math.min(Math.max(0, start), Math.max(0, ids.length - 1)));
  const many = ids.length > 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" && many) setIndex((i) => (i + 1) % ids.length);
      else if (e.key === "ArrowLeft" && many) setIndex((i) => (i - 1 + ids.length) % ids.length);
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [ids.length, many, onClose]);

  if (!ids.length) return null;
  return (
    <div
      className="fixed inset-0 z-[90] flex flex-col bg-black/85 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={title ? `Screenshot: ${title}` : "Screenshot"}
      onClick={onClose}
    >
      <div className="flex items-center justify-between gap-2 px-4 py-2 text-sm text-text">
        <span className="truncate font-semibold">{title}</span>
        <span className="flex items-center gap-2">
          {many && (
            <span className="tabular text-muted">
              {index + 1} / {ids.length}
            </span>
          )}
          <button className="grid h-8 w-8 place-items-center rounded-lg hover:bg-white/10" onClick={onClose} aria-label="Close" autoFocus>
            <X className="h-5 w-5" />
          </button>
        </span>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4 sm:px-12">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/screenshots/${ids[index]}/image`}
          alt={title ? `Screenshot of ${title}` : "Screenshot"}
          className="max-h-full max-w-full rounded-lg border border-line object-contain shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        />
        {many && (
          <>
            <button
              className="absolute left-1 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-black/60 hover:bg-black/80 sm:left-3"
              onClick={(e) => {
                e.stopPropagation();
                setIndex((i) => (i - 1 + ids.length) % ids.length);
              }}
              aria-label="Previous screenshot"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              className="absolute right-1 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-black/60 hover:bg-black/80 sm:right-3"
              onClick={(e) => {
                e.stopPropagation();
                setIndex((i) => (i + 1) % ids.length);
              }}
              aria-label="Next screenshot"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
