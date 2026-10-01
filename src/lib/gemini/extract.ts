import { GoogleGenAI } from "@google/genai";
import { EXTRACTION_JSON_SCHEMA, EXTRACTION_PROMPT } from "./schema";
import { normalizeExtraction, parseModelJson } from "./normalize";
import type { ExtractionResult } from "./types";

export class GeminiConfigError extends Error {
  constructor() {
    super("GEMINI_API_KEY is not configured on the server.");
    this.name = "GeminiConfigError";
  }
}

export class GeminiRequestError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = "GeminiRequestError";
  }
}

export interface ExtractOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  image: Buffer;
  mimeType: string;
  /** Injected for tests. */
  client?: Pick<GoogleGenAI, "models">;
  timeoutMs?: number;
}

/**
 * Check that an API key works by fetching the configured model's metadata
 * (no image tokens are spent).
 */
export async function testGeminiKey(opts: { apiKey: string; model: string; baseUrl?: string; client?: Pick<GoogleGenAI, "models"> }): Promise<{ ok: true; model: string } | { ok: false; message: string }> {
  if (!opts.apiKey && !opts.client) return { ok: false, message: "No API key provided." };
  const client = opts.client ?? new GoogleGenAI({ apiKey: opts.apiKey, ...(opts.baseUrl ? { httpOptions: { baseUrl: opts.baseUrl } } : {}) });
  try {
    const info = await client.models.get({ model: opts.model, config: { abortSignal: AbortSignal.timeout(15_000) } });
    return { ok: true, model: info.displayName || info.name || opts.model };
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 400 || status === 401 || status === 403) return { ok: false, message: "Google rejected this API key." };
    if (status === 404) return { ok: false, message: `The key works, but model "${opts.model}" was not found. Check GEMINI_MODEL.` };
    return { ok: false, message: `Could not reach Gemini${status ? ` (${status})` : ""}: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export interface ExtractOutput {
  raw: unknown;
  result: ExtractionResult;
  warnings: string[];
  model: string;
  durationMs: number;
}

/** Send one screenshot to Gemini and return validated structured data. */
export async function extractFromScreenshot(opts: ExtractOptions): Promise<ExtractOutput> {
  if (!opts.apiKey && !opts.client) throw new GeminiConfigError();
  const client = opts.client ?? new GoogleGenAI({ apiKey: opts.apiKey, ...(opts.baseUrl ? { httpOptions: { baseUrl: opts.baseUrl } } : {}) });
  const started = Date.now();

  let text: string | undefined;
  try {
    const response = await client.models.generateContent({
      model: opts.model,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { data: opts.image.toString("base64"), mimeType: opts.mimeType } },
            { text: EXTRACTION_PROMPT },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: EXTRACTION_JSON_SCHEMA,
        // Gemini 3.x is tuned for its default temperature (1.0); Google warns
        // that lower values can cause looping, so it is deliberately not set.
        abortSignal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
      },
    });
    text = response.text;
  } catch (err) {
    const status = (err as { status?: number }).status;
    const message = err instanceof Error ? err.message : String(err);
    const retryable = status === undefined || status === 429 || status >= 500;
    throw new GeminiRequestError(`Gemini request failed${status ? ` (${status})` : ""}: ${message}`, retryable);
  }

  const raw = parseModelJson(text);
  const { result, warnings } = normalizeExtraction(raw);
  return { raw, result, warnings, model: opts.model, durationMs: Date.now() - started };
}
