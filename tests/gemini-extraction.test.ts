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
    const err = await extractFromScreenshot({ apiKey: "k", model: "m", image: IMAGE, mimeType: "image/png" }).catch((e) => e);
    expect(err).toBeInstanceOf(GeminiRequestError);
    expect(err.retryable).toBe(true);

    generateContent.mockRejectedValue(Object.assign(new Error("Bad key"), { status: 400 }));
    const err2 = await extractFromScreenshot({ apiKey: "k", model: "m", image: IMAGE, mimeType: "image/png" }).catch((e) => e);
    expect(err2.retryable).toBe(false);
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
