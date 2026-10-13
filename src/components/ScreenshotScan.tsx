"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, TriangleAlert } from "lucide-react";
import { uploadWithProgress } from "@/lib/client-api";
import { prepareUpload } from "@/lib/shrink-image";

/**
 * Reading screenshots with one of the scan routes (bet slips, NBA picks):
 * each file is shrunk, sent, and its bets handed to `onBets`; problems are
 * collected per file ("slip.png: no bets found.").
 */
export function useScreenshotScan<T>(url: string, nothingFound: string, onBets: (bets: T[]) => void) {
  const [scanning, setScanning] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const scan = async (files: FileList | null) => {
    if (!files?.length) return;
    setErrors([]);
    for (const original of Array.from(files)) {
      setScanning((n) => n + 1);
      try {
        const { file } = await prepareUpload(original);
        const form = new FormData();
        form.append("file", file);
        const res = await uploadWithProgress<{ bets: T[] }>(url, form, () => {});
        if (!res.bets.length) setErrors((e) => [...e, `${original.name}: ${nothingFound}`]);
        onBets(res.bets);
      } catch (err) {
        setErrors((e) => [...e, `${original.name}: ${err instanceof Error ? err.message : String(err)}`]);
      } finally {
        setScanning((n) => n - 1);
      }
    }
  };
  return { scanning, errors, scan };
}

/** "Choose screenshots" (several at once), showing "Reading 2 screenshots…" while busy. */
export function ChooseScreenshots({ scanning, onFiles }: { scanning: number; onFiles: (files: FileList | null) => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/heic,image/heif" multiple hidden onChange={(e) => void onFiles(e.target.files).then(() => (e.target.value = ""))} />
      <button className="btn-primary" onClick={() => input.current?.click()} disabled={scanning > 0}>
        {scanning > 0 ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
        {scanning > 0 ? `Reading ${scanning} screenshot${scanning === 1 ? "" : "s"}…` : "Choose screenshots"}
      </button>
    </>
  );
}

export function ScanErrors({ errors }: { errors: string[] }) {
  return (
    <>
      {errors.map((e) => (
        <p key={e} className="mt-2 flex items-start gap-1.5 text-xs text-under">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {e}
        </p>
      ))}
    </>
  );
}
