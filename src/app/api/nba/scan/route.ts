import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { requireUserId } from "@/lib/auth/current";
import { handle, jsonError } from "@/lib/api";
import { GeminiConfigError, GeminiRequestError, generateJsonFromImage } from "@/lib/gemini/extract";
import { ExtractionFormatError } from "@/lib/gemini/normalize";
import { NBA_PICKS_JSON_SCHEMA, NBA_PICKS_PROMPT, normalizeNbaPicks } from "@/lib/gemini/nba";
import { MAX_SCREENSHOT_BYTES, detectImageType } from "@/lib/screenshots";
import { getGeminiApiKey, getGeminiModels, getSettings } from "@/lib/settings";
import { bookmakerFor, tipsterFor } from "@/lib/nba/aliases";
import { discordDate, parseOdds } from "@/lib/nba/parse";
import { gameTimeFromText } from "@/lib/nba/grade";

export const maxDuration = 120;

/**
 * Read one screenshot of NBA picks (multipart "file") and return the bets on
 * it for review: tipster (from the sender), units, odds (decimal), bookmaker
 * and when it was posted. Nothing is saved, and the image isn't kept.
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
      prompt: NBA_PICKS_PROMPT,
      schema: NBA_PICKS_JSON_SCHEMA,
    });
    const now = new Date();
    const bets = normalizeNbaPicks(out.raw).map((b) => {
      const posted = discordDate(b.postedText, settings.timezone, now);
      // The game's date when the slip shows it (that's what finds the result), else the day it was posted.
      const gameAt = gameTimeFromText(b.gameTimeText, posted ?? now, settings.timezone);
      return {
        ...b,
        tipster: tipsterFor(b.sender, settings.nbaTipsters),
        bookmaker: bookmakerFor(b.bookmakerText, settings.nbaBookmakers),
        odds: parseOdds(b.oddsText),
        placedAt: (gameAt ?? posted)?.toISOString() ?? null,
        gameTimeKnown: Boolean(gameAt),
      };
    });
    return NextResponse.json({ bets });
  } catch (err) {
    if (err instanceof GeminiConfigError) return jsonError(503, "gemini_not_configured", err.message);
    if (err instanceof GeminiRequestError) return jsonError(502, err.retryable ? "gemini_unavailable" : "gemini_rejected", err.message);
    if (err instanceof ExtractionFormatError) return jsonError(502, "gemini_invalid_output", err.message);
    throw err;
  }
});
