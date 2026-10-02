/**
 * Browser-side: keep uploads under serverless request limits (Vercel: 4.5 MB).
 * Small files are sent as they are. Bigger ones are re-encoded as JPEG (and
 * scaled down only if still too big); the original file's first bytes are
 * sent alongside so the server can still read the EXIF capture time.
 */

/** Files at or below this size are uploaded untouched. */
export const UPLOAD_SAFE_BYTES = 3_800_000;
/** Leading bytes of the original kept for EXIF (capture time). */
export const EXIF_HEAD_BYTES = 128 * 1024;

export interface PreparedUpload {
  file: File;
  /** Start of the original file when `file` was re-encoded, else null. */
  exifHead: Blob | null;
}

export async function prepareUpload(original: File): Promise<PreparedUpload> {
  if (original.size <= UPLOAD_SAFE_BYTES || typeof createImageBitmap !== "function") return { file: original, exifHead: null };
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(original);
  } catch {
    return { file: original, exifHead: null }; // e.g. HEIC the browser can't decode
  }
  try {
    let scale = 1;
    for (let attempt = 0; attempt < 5; attempt++) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) break;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
      if (blob && blob.size <= UPLOAD_SAFE_BYTES - EXIF_HEAD_BYTES) {
        const name = original.name.replace(/\.[^.]+$/, "") + ".jpg";
        return { file: new File([blob], name, { type: "image/jpeg", lastModified: original.lastModified }), exifHead: original.slice(0, EXIF_HEAD_BYTES) };
      }
      scale *= 0.8;
    }
  } finally {
    bitmap.close();
  }
  return { file: original, exifHead: null };
}
