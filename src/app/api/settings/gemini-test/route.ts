import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { handle, parseJson } from "@/lib/api";
import { getGeminiApiKey } from "@/lib/settings";
import { testGeminiKey } from "@/lib/gemini/extract";
import { geminiApiKeySchema } from "@/lib/validation/settings";

const schema = z.object({
  /** Test this key before saving it; omit to test the key currently in use. */
  apiKey: geminiApiKeySchema.optional(),
});

export const POST = handle(async (request: Request) => {
  const { apiKey } = await parseJson(request, schema);
  const config = env();
  const key = apiKey ?? (await getGeminiApiKey(db()));
  const result = await testGeminiKey({ apiKey: key, model: config.GEMINI_MODEL, baseUrl: config.GEMINI_BASE_URL || undefined });
  return NextResponse.json(result);
});
