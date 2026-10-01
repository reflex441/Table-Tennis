import type { Prisma } from "@/generated/prisma/client";
import type { ExtractionResult } from "@/lib/gemini/types";
import type { ScreenshotDTO } from "@/lib/types";

export const screenshotSelect = {
  id: true,
  createdAt: true,
  filename: true,
  mimeType: true,
  sizeBytes: true,
  capturedAt: true,
  capturedAtSource: true,
  status: true,
  error: true,
  extractions: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, model: true, result: true, warnings: true, createdAt: true } },
} satisfies Prisma.ScreenshotSelect;

export type ScreenshotRow = Prisma.ScreenshotGetPayload<{ select: typeof screenshotSelect }>;

export function toScreenshotDTO(s: ScreenshotRow, duplicate = false): ScreenshotDTO {
  const ex = s.extractions[0];
  return {
    id: s.id,
    filename: s.filename,
    mimeType: s.mimeType,
    sizeBytes: s.sizeBytes,
    createdAt: s.createdAt.toISOString(),
    capturedAt: s.capturedAt?.toISOString() ?? null,
    capturedAtSource: s.capturedAtSource,
    status: s.status,
    error: s.error,
    imageUrl: `/api/screenshots/${s.id}/image`,
    duplicate,
    extraction: ex
      ? { id: ex.id, model: ex.model, result: ex.result as unknown as ExtractionResult, warnings: ex.warnings, createdAt: ex.createdAt.toISOString() }
      : null,
  };
}
