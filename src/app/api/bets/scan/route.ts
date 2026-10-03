import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { requireUserId } from "@/lib/auth/current";
import { handle, jsonError } from "@/lib/api";
import { GeminiConfigError, GeminiRequestError, generateJsonFromImage } from "@/lib/gemini/extract";
import { ExtractionFormatError } from "@/lib/gemini/normalize";
import { BET_SLIP_JSON_SCHEMA, BET_SLIP_PROMPT, normalizeBetSlips, slipDate } from "@/lib/gemini/betslip";
import { MAX_SCREENSHOT_BYTES, detectImageType } from "@/lib/screenshots";
import { getGeminiApiKey, getGeminiModels, getSettings } from "@/lib/settings";

export const maxDuration = 120;

/**
 * Read one bet-slip screenshot (multipart "file") and return the bets on it
 * for review. Nothing is saved: the Profit page adds the ones you keep.
 */
export const POST = handle(async (request: Request) => {
  const userId = await requireUserId();
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) return jsonError(400, "missing_file", "No screenshot uploaded.");
  if (file.size > MAX_SCREENSHOT_BYTES) return jsonError(413, "file_too_large", "Screenshots must be 8 MB or smaller.");
  const buf = Buffer.from(await file.arrayBuffer());
  const mimeType = detectImageType(buf);
  if (!mimeType) return jsonError(415, "unsupported_type", "Only PNG, JPEG, WebP and HEIC images are supported.");

  const prisma = db();
  const apiKey = await getGeminiApiKey(prisma, userId);
  if (!apiKey) return jsonError(503, "gemini_not_configured", "Add your Gemini API key in Settings → Gemini API first.");
  const [models, settings] = await Promise.all([getGeminiModels(prisma, userId), getSettings(prisma, userId)]);

  try {
    const out = await generateJsonFromImage({
      apiKey,
      model: models.model,
      fallbackModel: models.fallback,
      baseUrl: env().GEMINI_BASE_URL || undefined,
      image: buf,
      mimeType,
      prompt: BET_SLIP_PROMPT,
      schema: BET_SLIP_JSON_SCHEMA,
    });
    const bets = normalizeBetSlips(out.raw).map((b) => ({ ...b, startsAt: slipDate(b.dateText, b.timeText, settings.timezone)?.toISOString() ?? null }));
    return NextResponse.json({ bets });
  } catch (err) {
    if (err instanceof GeminiConfigError) return jsonError(503, "gemini_not_configured", err.message);
    if (err instanceof GeminiRequestError) return jsonError(502, err.retryable ? "gemini_unavailable" : "gemini_rejected", err.message);
    if (err instanceof ExtractionFormatError) return jsonError(502, "gemini_invalid_output", err.message);
    throw err;
  }
});
