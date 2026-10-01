import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth/current";
import { handle, jsonError } from "@/lib/api";
import { MAX_SCREENSHOT_BYTES, detectImageType, determineCaptureTime, sha256 } from "@/lib/screenshots";
import { screenshotSelect, toScreenshotDTO } from "@/lib/screenshot-dto";
import { getSettings } from "@/lib/settings";

/** Upload one screenshot (multipart/form-data: file, lastModified). */
export const POST = handle(async (request: Request) => {
  const userId = await requireUserId();
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(400, "invalid_form", "Expected multipart/form-data with a 'file' field.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return jsonError(400, "missing_file", "No file uploaded.");
  if (file.size === 0) return jsonError(400, "empty_file", "The uploaded file is empty.");
  if (file.size > MAX_SCREENSHOT_BYTES) return jsonError(413, "file_too_large", "Screenshots must be 8 MB or smaller.");

  const buf = Buffer.from(await file.arrayBuffer());
  const mimeType = detectImageType(buf);
  if (!mimeType) return jsonError(415, "unsupported_type", "Only PNG, JPEG, WebP and HEIC images are supported.");

  const prisma = db();
  const hash = sha256(buf);
  const existing = await prisma.screenshot.findFirst({ where: { userId, sha256: hash }, orderBy: { createdAt: "desc" }, select: screenshotSelect });
  if (existing) return NextResponse.json({ screenshot: toScreenshotDTO(existing, true) });

  const settings = await getSettings(prisma, userId);
  const lastModifiedRaw = Number(form.get("lastModified"));
  const { capturedAt, source } = await determineCaptureTime({
    buf,
    timezone: settings.timezone,
    lastModified: Number.isFinite(lastModifiedRaw) && lastModifiedRaw > 0 ? lastModifiedRaw : null,
  });

  const created = await prisma.screenshot.create({
    data: {
      filename: (file.name || "screenshot").slice(0, 200),
      mimeType,
      sizeBytes: buf.length,
      sha256: hash,
      data: buf,
      capturedAt,
      capturedAtSource: source,
      userId,
    },
    select: screenshotSelect,
  });
  return NextResponse.json({ screenshot: toScreenshotDTO(created) }, { status: 201 });
});

export const GET = handle(async (request: Request) => {
  const url = new URL(request.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 20));
  const rows = await db().screenshot.findMany({ where: { userId: await requireUserId() }, orderBy: { createdAt: "desc" }, take: limit, select: screenshotSelect });
  return NextResponse.json({ screenshots: rows.map((r) => toScreenshotDTO(r)) });
});
