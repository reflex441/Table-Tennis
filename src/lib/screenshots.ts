import { createHash } from "node:crypto";
import { DateTime } from "luxon";
import type { CaptureSource } from "@/lib/time/resolve";

export const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;

/** Detect the image type from magic bytes (never trust the client's mime type). */
export function detectImageType(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString("ascii", 1, 4) === "PNG") return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buf.toString("ascii", 4, 8) === "ftyp") {
    const brand = buf.toString("ascii", 8, 12);
    if (["heic", "heix", "hevc", "hevx", "heim", "heis"].includes(brand)) return "image/heic";
    if (["mif1", "msf1"].includes(brand)) return "image/heif";
  }
  return null;
}

export function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Read the capture time from EXIF metadata. EXIF stores local wall-clock
 * time; we use OffsetTimeOriginal when present, otherwise interpret it in
 * the user's timezone.
 */
export async function readExifCaptureTime(buf: Buffer, timezone: string): Promise<Date | null> {
  try {
    const exifr = (await import("exifr")).default;
    const data = (await exifr.parse(buf, {
      pick: ["DateTimeOriginal", "CreateDate", "OffsetTimeOriginal", "OffsetTime"],
      reviveValues: false,
    })) as Record<string, string> | undefined;
    const raw = data?.DateTimeOriginal ?? data?.CreateDate;
    if (!raw || typeof raw !== "string") return null;
    const offset = data?.OffsetTimeOriginal ?? data?.OffsetTime;
    const zone = typeof offset === "string" && /^[+-]\d{2}:\d{2}$/.test(offset) ? `UTC${offset}` : timezone;
    const dt = DateTime.fromFormat(raw.trim(), "yyyy:MM:dd HH:mm:ss", { zone });
    return dt.isValid ? dt.toJSDate() : null;
  } catch {
    return null;
  }
}

/** Decide the best capture time for a screenshot. */
export async function determineCaptureTime(opts: {
  buf: Buffer;
  timezone: string;
  /** File.lastModified sent by the browser (ms since epoch). */
  lastModified?: number | null;
  now?: Date;
}): Promise<{ capturedAt: Date | null; source: CaptureSource }> {
  const now = opts.now ?? new Date();
  const exif = await readExifCaptureTime(opts.buf, opts.timezone);
  if (exif && exif.getTime() <= now.getTime() + 5 * 60_000) return { capturedAt: exif, source: "EXIF" };
  if (opts.lastModified && Number.isFinite(opts.lastModified)) {
    const lm = new Date(opts.lastModified);
    // Ignore obviously bogus timestamps (future, or older than a year).
    if (lm.getTime() <= now.getTime() + 5 * 60_000 && lm.getTime() > now.getTime() - 365 * 86_400_000) {
      return { capturedAt: lm, source: "FILE_MODIFIED" };
    }
  }
  return { capturedAt: null, source: "NONE" };
}
