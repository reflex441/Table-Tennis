import type { PrismaClient } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { requireUserId } from "@/lib/auth/current";
import { jsonError } from "@/lib/api";
import { MAX_SCREENSHOT_BYTES, detectImageType } from "@/lib/screenshots";
import { getGeminiApiKey, getGeminiModels, getSettings } from "@/lib/settings";
import type { SettingsDTO } from "@/lib/validation/settings";
import { GeminiConfigError, GeminiRequestError, generateJsonFromImage } from "./extract";
import { ExtractionFormatError } from "./normalize";

/**
 * Shared by the routes that read one screenshot (multipart "file") with
 * Gemini - bet slips and NBA picks: checks the upload and the Gemini key,
 * asks Gemini, hands its reply to `respond`, and turns Gemini errors (including
 * an unreadable reply found by `respond`) into error replies. Nothing is saved.
 */
export async function readScreenshotWithGemini(
  request: Request,
  prompt: string,
  schema: unknown,
  respond: (ctx: { raw: unknown; userId: string; settings: SettingsDTO; prisma: PrismaClient }) => Promise<Response>,
): Promise<Response> {
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
      prompt,
      schema,
    });
    return await respond({ raw: out.raw, userId, settings, prisma });
  } catch (err) {
    if (err instanceof GeminiConfigError) return jsonError(503, "gemini_not_configured", err.message);
    if (err instanceof GeminiRequestError) return jsonError(502, err.retryable ? "gemini_unavailable" : "gemini_rejected", err.message);
    if (err instanceof ExtractionFormatError) return jsonError(502, "gemini_invalid_output", err.message);
    throw err;
  }
}
