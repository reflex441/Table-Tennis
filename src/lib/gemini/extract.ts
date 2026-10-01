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
  image: Buffer;
  mimeType: string;
  /** Injected for tests. */
  client?: Pick<GoogleGenAI, "models">;
  timeoutMs?: number;
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
  const client = opts.client ?? new GoogleGenAI({ apiKey: opts.apiKey });
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
        temperature: 0,
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
