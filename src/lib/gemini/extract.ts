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
  /** Tried when `model` stays overloaded / rate-limited after retries. */
  fallbackModel?: string;
  baseUrl?: string;
  image: Buffer;
  mimeType: string;
  /** Injected for tests. */
  client?: Pick<GoogleGenAI, "models">;
  /** Per-request timeout. */
  timeoutMs?: number;
  /** Total time allowed including retries. */
  budgetMs?: number;
  /** Injected for tests to skip real waiting. */
  sleep?: (ms: number) => Promise<void>;
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

/** HTTP statuses worth retrying: rate limit, overload and server errors. */
function isRetryableStatus(status: number | undefined): boolean {
  return status === undefined || status === 408 || status === 429 || status >= 500;
}

/** Turn Google's error into something a person can act on. */
function friendlyMessage(status: number | undefined, raw: string, attempts: number, models: string[]): string {
  const tried = `Tried ${attempts} time${attempts === 1 ? "" : "s"} (${models.join(" then ")}).`;
  if (status === 503 || /overloaded|high demand|UNAVAILABLE/i.test(raw)) {
    return `Gemini is overloaded right now (Google returned 503). ${tried} This is on Google's side and usually clears within a few minutes - press Retry.`;
  }
  if (status === 429) {
    return `Gemini rate limit reached (429). ${tried} Free API keys only allow a limited number of requests per minute - wait a minute, then press Retry.`;
  }
  if (status === undefined) return `Could not reach Gemini (network error or timeout). ${tried} Press Retry.`;
  if (status >= 500) return `Gemini had a server error (${status}). ${tried} Press Retry.`;
  if (status === 400 || status === 401 || status === 403) return `Gemini rejected the request (${status}) - check the API key in Settings. ${raw}`;
  return `Gemini request failed (${status}): ${raw}`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Send one screenshot to Gemini and return validated structured data. */
export async function extractFromScreenshot(opts: ExtractOptions): Promise<ExtractOutput> {
  if (!opts.apiKey && !opts.client) throw new GeminiConfigError();
  const client = opts.client ?? new GoogleGenAI({ apiKey: opts.apiKey, ...(opts.baseUrl ? { httpOptions: { baseUrl: opts.baseUrl } } : {}) });
  const started = Date.now();
  const wait = opts.sleep ?? sleep;
  // Stay inside the route's time limit even when retrying.
  const budgetMs = opts.budgetMs ?? 100_000;

  // Overload/rate-limit errors are usually brief: retry the main model with
  // backoff, then try the fallback model (a separate capacity pool).
  const plan: { model: string; delayBeforeMs: number }[] = [
    { model: opts.model, delayBeforeMs: 0 },
    { model: opts.model, delayBeforeMs: 2_000 },
    { model: opts.model, delayBeforeMs: 6_000 },
  ];
  if (opts.fallbackModel && opts.fallbackModel !== opts.model) {
    plan.push({ model: opts.fallbackModel, delayBeforeMs: 1_000 }, { model: opts.fallbackModel, delayBeforeMs: 4_000 });
  }

  let text: string | undefined;
  let usedModel = opts.model;
  let lastStatus: number | undefined;
  let lastMessage = "";
  let attempts = 0;
  const modelsTried: string[] = [];

  for (const step of plan) {
    const elapsed = Date.now() - started;
    if (attempts > 0 && elapsed + step.delayBeforeMs + 5_000 > budgetMs) break;
    if (step.delayBeforeMs) await wait(step.delayBeforeMs);
    attempts++;
    if (!modelsTried.includes(step.model)) modelsTried.push(step.model);
    const remaining = Math.max(5_000, budgetMs - (Date.now() - started));
    try {
      const response = await client.models.generateContent({
        model: step.model,
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
          abortSignal: AbortSignal.timeout(Math.min(opts.timeoutMs ?? 60_000, remaining)),
        },
      });
      text = response.text;
      usedModel = step.model;
      lastStatus = undefined;
      break;
    } catch (err) {
      lastStatus = (err as { status?: number }).status;
      lastMessage = err instanceof Error ? err.message : String(err);
      if (!isRetryableStatus(lastStatus)) {
        throw new GeminiRequestError(friendlyMessage(lastStatus, lastMessage, attempts, modelsTried), false);
      }
    }
  }

  if (text === undefined) {
    throw new GeminiRequestError(friendlyMessage(lastStatus, lastMessage, attempts, modelsTried), true);
  }

  const raw = parseModelJson(text);
  const { result, warnings } = normalizeExtraction(raw);
  return { raw, result, warnings, model: usedModel, durationMs: Date.now() - started };
}
