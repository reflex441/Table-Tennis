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
  /**
   * Backup models (a list, or one comma-separated string) tried when `model`
   * is overloaded / rate-limited or not available. Each has its own capacity.
   */
  fallbackModel?: string | string[];
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
export async function testGeminiKey(opts: {
  apiKey: string;
  model: string;
  baseUrl?: string;
  client?: Pick<GoogleGenAI, "models">;
}): Promise<{ ok: true; model: string; available: string[] } | { ok: false; message: string; available?: string[] }> {
  if (!opts.apiKey && !opts.client) return { ok: false, message: "No API key provided." };
  const client = opts.client ?? new GoogleGenAI({ apiKey: opts.apiKey, ...(opts.baseUrl ? { httpOptions: { baseUrl: opts.baseUrl } } : {}) });
  try {
    const info = await client.models.get({ model: opts.model, config: { abortSignal: AbortSignal.timeout(15_000) } });
    return { ok: true, model: info.displayName || info.name || opts.model, available: await listGeminiModels(client) };
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 400 || status === 401 || status === 403) return { ok: false, message: "Google rejected this API key." };
    if (status === 404) {
      return { ok: false, message: `The key works, but model "${opts.model}" was not found. Pick one of the models listed below.`, available: await listGeminiModels(client) };
    }
    return { ok: false, message: `Could not reach Gemini${status ? ` (${status})` : ""}: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Gemini model IDs this key can scan with (best effort; [] on error). */
async function listGeminiModels(client: Pick<GoogleGenAI, "models">): Promise<string[]> {
  try {
    const pager = await client.models.list({ config: { pageSize: 100, abortSignal: AbortSignal.timeout(15_000) } });
    const names: string[] = [];
    for await (const m of pager) {
      const name = (m.name ?? "").replace(/^models\//, "");
      if (/^gemini-/.test(name) && (!m.supportedActions || m.supportedActions.includes("generateContent"))) names.push(name);
      if (names.length >= 60) break;
    }
    // Flash models first (free tier), newest first.
    return [...new Set(names)].sort((a, b) => Number(/flash/.test(b)) - Number(/flash/.test(a)) || b.localeCompare(a));
  } catch {
    return [];
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
  if (status === 404) return `Gemini model not found (404): ${models.join(", ")}. Check the model names in Settings → Gemini API (Test lists the models your key can use).`;
  if (status === undefined) return `Could not reach Gemini (network error or timeout). ${tried} Press Retry.`;
  if (status >= 500) return `Gemini had a server error (${status}). ${tried} Press Retry.`;
  if (status === 401 || status === 403 || /api key/i.test(raw)) return `Gemini rejected the API key (${status}) - check it in Settings. ${raw}`;
  if (status === 400) return `Gemini rejected the request (400): ${raw}`;
  return `Gemini request failed (${status}): ${raw}`;
}

/** Pause before each round of attempts over all models. */
const ROUND_DELAYS_MS = [0, 1_500, 4_000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Send one screenshot to Gemini and return validated structured data. */
export async function extractFromScreenshot(opts: ExtractOptions): Promise<ExtractOutput> {
  if (!opts.apiKey && !opts.client) throw new GeminiConfigError();
  const client = opts.client ?? new GoogleGenAI({ apiKey: opts.apiKey, ...(opts.baseUrl ? { httpOptions: { baseUrl: opts.baseUrl } } : {}) });
  const started = Date.now();
  const wait = opts.sleep ?? sleep;
  // Stay inside the route's time limit even when retrying.
  const budgetMs = opts.budgetMs ?? 100_000;

  // Overload/rate-limit errors are usually brief and per model. Go through
  // every model straight away (each has its own capacity), then repeat the
  // round after a short pause - rather than waiting on one busy model.
  const fallbacks = Array.isArray(opts.fallbackModel) ? opts.fallbackModel : (opts.fallbackModel ?? "").split(",");
  const models = [...new Set([opts.model, ...fallbacks].map((m) => m.trim()).filter(Boolean))];
  const plan: { model: string; round: number }[] = [];
  for (let round = 0; round < ROUND_DELAYS_MS.length; round++) for (const model of models) plan.push({ model, round });
  /** Models Google says don't exist (404) are skipped from then on. */
  const missing = new Set<string>();

  let text: string | undefined;
  let usedModel = opts.model;
  let lastStatus: number | undefined;
  let lastMessage = "";
  let attempts = 0;
  const modelsTried: string[] = [];

  let i = 0;
  let lastRound = 0;
  while (i < plan.length) {
    const step = plan[i];
    if (missing.has(step.model)) {
      i++;
      continue;
    }
    const delay = step.round === lastRound ? 0 : ROUND_DELAYS_MS[step.round];
    lastRound = step.round;
    const elapsed = Date.now() - started;
    if (attempts > 0 && elapsed + delay + 5_000 > budgetMs) break;
    if (delay) await wait(delay);
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
          abortSignal: AbortSignal.timeout(Math.min(opts.timeoutMs ?? 45_000, remaining)),
        },
      });
      text = response.text;
      usedModel = step.model;
      lastStatus = undefined;
      break;
    } catch (err) {
      lastStatus = (err as { status?: number }).status;
      lastMessage = err instanceof Error ? err.message : String(err);
      if (lastStatus === 404) {
        // Wrong / unavailable model name: use the other models instead.
        console.warn(`Gemini model "${step.model}" not found - skipping it.`);
        missing.add(step.model);
        if (models.every((m) => missing.has(m))) {
          throw new GeminiRequestError(friendlyMessage(404, lastMessage, attempts, models), false);
        }
        i++;
        continue;
      }
      if (!isRetryableStatus(lastStatus)) {
        throw new GeminiRequestError(friendlyMessage(lastStatus, lastMessage, attempts, modelsTried), false);
      }
    }
    i++;
  }

  if (text === undefined) {
    throw new GeminiRequestError(friendlyMessage(lastStatus, lastMessage, attempts, modelsTried), true);
  }

  const raw = parseModelJson(text);
  const { result, warnings } = normalizeExtraction(raw);
  return { raw, result, warnings, model: usedModel, durationMs: Date.now() - started };
}
