import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { handle, jsonError } from "@/lib/api";
import { extractFromScreenshot, GeminiConfigError, GeminiRequestError } from "@/lib/gemini/extract";
import { ExtractionFormatError } from "@/lib/gemini/normalize";
import { screenshotSelect, toScreenshotDTO } from "@/lib/screenshot-dto";
import { Prisma } from "@/generated/prisma/client";
import { getGeminiApiKey, getSettings } from "@/lib/settings";
import { SCAN_SPEED_THINKING } from "@/lib/validation/settings";

export const maxDuration = 120;

/** Run Gemini over a stored screenshot and persist the validated result. */
export const POST = handle(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const prisma = db();
  const shot = await prisma.screenshot.findUnique({ where: { id }, select: { id: true, data: true, mimeType: true, status: true } });
  if (!shot) return jsonError(404, "not_found", "Screenshot not found.");

  const config = env();
  const apiKey = await getGeminiApiKey(prisma);
  if (!apiKey) {
    return jsonError(503, "gemini_not_configured", "No Gemini API key configured. Add one in Settings → Gemini API.");
  }

  // Claim the screenshot so double-clicks don't trigger two Gemini calls.
  const claimed = await prisma.screenshot.updateMany({
    where: { id, status: { not: "PROCESSING" } },
    data: { status: "PROCESSING", error: null },
  });
  if (!claimed.count) {
    const stale = await prisma.screenshot.updateMany({
      where: { id, status: "PROCESSING", updatedAt: { lt: new Date(Date.now() - 3 * 60_000) } },
      data: { status: "PROCESSING", error: null },
    });
    if (!stale.count) return jsonError(409, "already_processing", "This screenshot is already being scanned.");
  }

  try {
    const out = await extractFromScreenshot({
      apiKey,
      model: config.GEMINI_MODEL,
      fallbackModel: config.GEMINI_FALLBACK_MODEL || undefined,
      thinkingLevel: SCAN_SPEED_THINKING[(await getSettings(prisma)).scanSpeed],
      baseUrl: config.GEMINI_BASE_URL || undefined,
      image: Buffer.from(shot.data),
      mimeType: shot.mimeType,
    });
    await prisma.extraction.create({
      data: {
        screenshotId: id,
        model: out.model,
        durationMs: out.durationMs,
        rawResponse: (out.raw ?? {}) as Prisma.InputJsonValue,
        result: out.result as unknown as Prisma.InputJsonValue,
        warnings: out.warnings,
      },
    });
    const row = await prisma.screenshot.update({ where: { id }, data: { status: "EXTRACTED", error: null }, select: screenshotSelect });
    return NextResponse.json({ screenshot: toScreenshotDTO(row) });
  } catch (err) {
    let status = 500;
    let code = "extraction_failed";
    let message = "Screenshot analysis failed.";
    if (err instanceof GeminiConfigError) {
      status = 503;
      code = "gemini_not_configured";
      message = err.message;
    } else if (err instanceof GeminiRequestError) {
      status = 502;
      code = err.retryable ? "gemini_unavailable" : "gemini_rejected";
      message = err.message;
    } else if (err instanceof ExtractionFormatError) {
      status = 502;
      code = "gemini_invalid_output";
      message = err.message;
    } else {
      console.error(err);
    }
    await prisma.screenshot.update({ where: { id }, data: { status: "FAILED", error: message.slice(0, 500) } });
    return jsonError(status, code, message);
  }
});
