import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractFromScreenshot, GeminiConfigError, GeminiRequestError, testGeminiKey } from "@/lib/gemini/extract";
import { ExtractionFormatError, normalizeExtraction, parseModelJson } from "@/lib/gemini/normalize";
import { EXTRACTION_JSON_SCHEMA } from "@/lib/gemini/schema";

// The real SDK is never contacted: every test injects or mocks the client.
const generateContent = vi.fn();
vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn().mockImplementation(function GoogleGenAI() {
    return { models: { generateContent } };
  }),
}));

const IMAGE = Buffer.from("fake-image-bytes");
const noWait = async () => {};

const sample = {
  layout: "match list",
  visibleClock: "17:42",
  visibleDate: null,
  timezoneText: null,
  matches: [
    {
      player1: "Varcl J",
      player2: "Jan S",
      competition: "Czech Liga Pro",
      timeText: "Today at 6:00 PM",
      dateText: null,
      selection: "OVER",
      pointsLine: 74.5,
      ouStats: "20/9",
      ouHitRate: 69,
      edge: 47,
      confidence: 0.92,
    },
  ],
};

beforeEach(() => {
  generateContent.mockReset();
});

describe("extractFromScreenshot", () => {
  it("sends the image with a JSON schema and returns validated data", async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify(sample) });
    const out = await extractFromScreenshot({ apiKey: "test-key", model: "gemini-test", image: IMAGE, mimeType: "image/png" });

    expect(generateContent).toHaveBeenCalledTimes(1);
    const req = generateContent.mock.calls[0][0];
    expect(req.model).toBe("gemini-test");
    expect(req.config.responseMimeType).toBe("application/json");
    expect(req.config.responseJsonSchema).toBe(EXTRACTION_JSON_SCHEMA);
    // Gemini 3.x should run at its default temperature.
    expect(req.config.temperature).toBeUndefined();
    expect(req.contents[0].parts[0].inlineData).toEqual({ data: IMAGE.toString("base64"), mimeType: "image/png" });

    expect(out.result.matches).toHaveLength(1);
    expect(out.result.matches[0]).toMatchObject({
      player1: "Varcl J",
      player2: "Jan S",
      competition: "Czech Liga Pro",
      selection: "OVER",
      ouStats: "20/9",
      ouHitRate: 69,
      edge: 47,
    });
    expect(out.result.visibleClock).toBe("17:42");
    expect(out.warnings).toEqual([]);
  });

  it("asks for less thinking when a thinking level is given (faster scans)", async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify(sample) });
    await extractFromScreenshot({ apiKey: "k", model: "m", image: IMAGE, mimeType: "image/png", thinkingLevel: "LOW" });
    expect(generateContent.mock.calls[0][0].config.thinkingConfig).toEqual({ thinkingLevel: "LOW" });
    generateContent.mockClear();
    await extractFromScreenshot({ apiKey: "k", model: "m", image: IMAGE, mimeType: "image/png" });
    expect(generateContent.mock.calls[0][0].config.thinkingConfig).toBeUndefined();
  });

  it("steps up the thinking level when a model rejects it (e.g. MINIMAL)", async () => {
    const unsupported = (lvl: string) => Object.assign(new Error(`{"error":{"code":400,"message":"Thinking level ${lvl} is not supported for this model. Please retry with other thinking level.","status":"INVALID_ARGUMENT"}}`), { status: 400 });
    generateContent.mockImplementation(async (req: { config: { thinkingConfig?: { thinkingLevel: string } } }) => {
      const lvl = req.config.thinkingConfig?.thinkingLevel;
      if (lvl === "MINIMAL" || lvl === "LOW") throw unsupported(lvl);
      return { text: JSON.stringify(sample) };
    });
    const out = await extractFromScreenshot({ apiKey: "k", model: "m", image: IMAGE, mimeType: "image/png", thinkingLevel: "MINIMAL", sleep: noWait });
    expect(out.result.matches).toHaveLength(1);
    expect(generateContent.mock.calls.map((c) => c[0].config.thinkingConfig?.thinkingLevel ?? "default")).toEqual(["MINIMAL", "LOW", "default"]);
  });

  it("does not blame the API key for other bad requests", async () => {
    generateContent.mockRejectedValue(Object.assign(new Error("Request contains an invalid argument."), { status: 400 }));
    const err = await extractFromScreenshot({ apiKey: "k", model: "m", image: IMAGE, mimeType: "image/png", sleep: noWait }).catch((e) => e);
    expect(err.message).not.toMatch(/API key/);
    generateContent.mockRejectedValue(Object.assign(new Error("API key not valid. Please pass a valid API key."), { status: 400 }));
    const err2 = await extractFromScreenshot({ apiKey: "k", model: "m", image: IMAGE, mimeType: "image/png", sleep: noWait }).catch((e) => e);
    expect(err2.message).toMatch(/check it in Settings/);
  });

  it("supports an injected client", async () => {
    const client = { models: { generateContent: vi.fn().mockResolvedValue({ text: JSON.stringify({ ...sample, matches: [] }) }) } };
    const out = await extractFromScreenshot({ apiKey: "", model: "m", image: IMAGE, mimeType: "image/jpeg", client: client as never });
    expect(out.result.matches).toEqual([]);
  });

  it("requires an API key", async () => {
    await expect(extractFromScreenshot({ apiKey: "", model: "m", image: IMAGE, mimeType: "image/png" })).rejects.toBeInstanceOf(GeminiConfigError);
  });

  it("wraps API errors and marks rate limits as retryable", async () => {
    generateContent.mockRejectedValue(Object.assign(new Error("Resource exhausted"), { status: 429 }));
    const err = await extractFromScreenshot({ apiKey: "k", model: "m", image: IMAGE, mimeType: "image/png", sleep: noWait }).catch((e) => e);
    expect(err).toBeInstanceOf(GeminiRequestError);
    expect(err.retryable).toBe(true);
    expect(err.message).toMatch(/rate limit/);

    generateContent.mockReset();
    generateContent.mockRejectedValue(Object.assign(new Error("Bad key"), { status: 400 }));
    const err2 = await extractFromScreenshot({ apiKey: "k", model: "m", image: IMAGE, mimeType: "image/png", sleep: noWait }).catch((e) => e);
    expect(err2.retryable).toBe(false);
    expect(generateContent).toHaveBeenCalledTimes(1); // no retries for a bad request
  });

  it("retries when Gemini is overloaded (503) and succeeds", async () => {
    const overloaded = Object.assign(new Error('{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}'), { status: 503 });
    generateContent.mockRejectedValueOnce(overloaded).mockRejectedValueOnce(overloaded).mockResolvedValue({ text: JSON.stringify(sample) });
    const waits: number[] = [];
    const out = await extractFromScreenshot({ apiKey: "k", model: "gemini-3.5-flash", image: IMAGE, mimeType: "image/png", sleep: async (ms) => void waits.push(ms) });
    expect(out.model).toBe("gemini-3.5-flash");
    expect(out.result.matches).toHaveLength(1);
    expect(generateContent).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([2_000, 6_000]);
  });

  it("falls back to the lighter model when the main one stays overloaded", async () => {
    const overloaded = Object.assign(new Error("UNAVAILABLE"), { status: 503 });
    generateContent.mockImplementation(async (req: { model: string }) => {
      if (req.model === "gemini-3.5-flash") throw overloaded;
      return { text: JSON.stringify(sample) };
    });
    const out = await extractFromScreenshot({
      apiKey: "k",
      model: "gemini-3.5-flash",
      fallbackModel: "gemini-3.8-flash",
      image: IMAGE,
      mimeType: "image/png",
      sleep: noWait,
    });
    expect(out.model).toBe("gemini-3.8-flash");
    expect(generateContent.mock.calls.map((c) => c[0].model)).toEqual(["gemini-3.5-flash", "gemini-3.5-flash", "gemini-3.5-flash", "gemini-3.8-flash"]);
  });

  it("gives a clear message when every attempt is overloaded", async () => {
    generateContent.mockRejectedValue(Object.assign(new Error("high demand"), { status: 503 }));
    const err = await extractFromScreenshot({ apiKey: "k", model: "a", fallbackModel: "b", image: IMAGE, mimeType: "image/png", sleep: noWait }).catch((e) => e);
    expect(err).toBeInstanceOf(GeminiRequestError);
    expect(err.retryable).toBe(true);
    expect(err.message).toMatch(/overloaded right now/);
    expect(err.message).toMatch(/Tried 5 times \(a then b\)/);
  });

  it("stops retrying when the time budget is used up", async () => {
    generateContent.mockRejectedValue(Object.assign(new Error("busy"), { status: 503 }));
    await extractFromScreenshot({ apiKey: "k", model: "a", image: IMAGE, mimeType: "image/png", sleep: noWait, budgetMs: 4_000 }).catch(() => {});
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed JSON", async () => {
    generateContent.mockResolvedValue({ text: "Sorry, I can't do that" });
    await expect(extractFromScreenshot({ apiKey: "k", model: "m", image: IMAGE, mimeType: "image/png" })).rejects.toBeInstanceOf(ExtractionFormatError);
  });
});

describe("normalizeExtraction - server-side validation", () => {
  it("keeps nulls for missing information (partial screenshots)", () => {
    const { result } = normalizeExtraction({
      matches: [{ player1: null, player2: null, competition: null, timeText: null, dateText: null, selection: "UNDER", pointsLine: null, ouStats: "12/30", ouHitRate: 71, edge: 22, confidence: 0.7 }],
    });
    expect(result.matches[0]).toMatchObject({ player1: null, player2: null, timeText: null, selection: "UNDER", ouStats: "12/30" });
    expect(result.layout).toBeNull();
  });

  it("coerces harmless formatting but never invents values", () => {
    const { result, warnings } = normalizeExtraction({
      matches: [{ player1: "  Varcl   J ", player2: "Jan S", selection: "over", ouHitRate: "69%", edge: "47 %", ouStats: "20 / 9", pointsLine: "74,5" }],
    });
    const m = result.matches[0];
    expect(m.player1).toBe("Varcl J");
    expect(m.selection).toBe("OVER");
    expect(m.ouHitRate).toBe(69);
    expect(m.edge).toBe(47);
    expect(m.ouStats).toBe("20/9");
    expect(m.pointsLine).toBe(74.5);
    expect(m.competition).toBeNull();
    expect(warnings).toEqual([]);
  });

  it("replaces invalid values with null and records warnings", () => {
    const { result, warnings } = normalizeExtraction({
      matches: [{ player1: "A", player2: "B", selection: "MAYBE", ouHitRate: 140, edge: "lots", ouStats: "twenty", confidence: 3 }],
    });
    const m = result.matches[0];
    expect(m.selection).toBeNull();
    expect(m.ouHitRate).toBeNull();
    expect(m.edge).toBeNull();
    expect(m.ouStats).toBeNull();
    expect(m.confidence).toBeNull();
    expect(warnings.length).toBe(5);
  });

  it("treats placeholder strings as missing", () => {
    const { result } = normalizeExtraction({ matches: [{ player1: "Varcl J", player2: "N/A", competition: "unknown", timeText: "-" }] });
    expect(result.matches[0].player2).toBeNull();
    expect(result.matches[0].competition).toBeNull();
    expect(result.matches[0].timeText).toBeNull();
  });

  it("drops entries without any information", () => {
    const { result } = normalizeExtraction({ matches: [{ player1: null, player2: null }, { player1: "A", player2: "B" }] });
    expect(result.matches).toHaveLength(1);
  });

  it("warns when O/U record and percentage disagree", () => {
    const ok = normalizeExtraction({ matches: [{ player1: "A", player2: "B", ouStats: "20/9", ouHitRate: 69 }] });
    expect(ok.warnings).toEqual([]);
    const under = normalizeExtraction({ matches: [{ player1: "A", player2: "B", ouStats: "9/20", ouHitRate: 69 }] });
    expect(under.warnings).toEqual([]);
    const bad = normalizeExtraction({ matches: [{ player1: "A", player2: "B", ouStats: "20/9", ouHitRate: 40 }] });
    expect(bad.warnings[0]).toMatch(/does not match/);
  });

  it("rejects responses with the wrong shape", () => {
    expect(() => normalizeExtraction(null)).toThrow(ExtractionFormatError);
    expect(() => normalizeExtraction([])).toThrow(ExtractionFormatError);
    expect(() => normalizeExtraction({ matches: "nope" })).toThrow(ExtractionFormatError);
  });

  it("parses fenced JSON", () => {
    expect(parseModelJson('```json\n{"matches":[]}\n```')).toEqual({ matches: [] });
    expect(() => parseModelJson("")).toThrow(ExtractionFormatError);
  });
});

describe("testGeminiKey", () => {
  const client = (get: ReturnType<typeof vi.fn>) => ({ models: { get } }) as never;

  it("reports a working key", async () => {
    const get = vi.fn().mockResolvedValue({ name: "models/gemini-3.5-flash", displayName: "Gemini 3.5 Flash" });
    expect(await testGeminiKey({ apiKey: "k", model: "gemini-3.5-flash", client: client(get) })).toEqual({ ok: true, model: "Gemini 3.5 Flash" });
    expect(get.mock.calls[0][0].model).toBe("gemini-3.5-flash");
  });

  it("explains rejected keys and unknown models", async () => {
    const rejected = await testGeminiKey({ apiKey: "k", model: "m", client: client(vi.fn().mockRejectedValue(Object.assign(new Error("bad"), { status: 400 }))) });
    expect(rejected).toEqual({ ok: false, message: "Google rejected this API key." });
    const missing = await testGeminiKey({ apiKey: "k", model: "nope", client: client(vi.fn().mockRejectedValue(Object.assign(new Error("nf"), { status: 404 }))) });
    expect(missing.ok).toBe(false);
  });

  it("requires a key", async () => {
    expect((await testGeminiKey({ apiKey: "", model: "m" })).ok).toBe(false);
  });
});
