/**
 * JSON schema sent to Gemini as `responseJsonSchema`. Every field is nullable
 * so the model can (and must) return null instead of inventing values.
 */
const nullableString = (description: string) => ({ type: ["string", "null"], description });
const nullableNumber = (description: string) => ({ type: ["number", "null"], description });

export const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    layout: nullableString(
      "Short description of the screenshot layout, e.g. 'match list', 'single match detail', 'statistics table'.",
    ),
    visibleClock: nullableString(
      "The device clock shown in the phone/desktop status bar exactly as displayed (e.g. '17:42' or '5:42 PM'). Null if no status bar clock is visible.",
    ),
    visibleDate: nullableString("Any current-date indicator shown in the device chrome (not a match date). Null if none."),
    timezoneText: nullableString(
      "A timezone label explicitly printed next to match times (e.g. 'CET', 'UTC+2', 'GMT'). Null if none is printed.",
    ),
    matches: {
      type: "array",
      description: "One entry per distinct table tennis match visible in the screenshot. Empty array if none.",
      items: {
        type: "object",
        properties: {
          player1: nullableString("First (left/top/home) player name exactly as written, e.g. 'Varcl J'."),
          player2: nullableString("Second (right/bottom/away) player name exactly as written."),
          competition: nullableString("League or competition name exactly as written, e.g. 'Czech Liga Pro'."),
          timeText: nullableString(
            "The match start time text copied verbatim, including relative words, e.g. 'Today at 6:00 PM', 'Starts in 45 minutes', '21/09/2026 15:00'. Do NOT convert or compute.",
          ),
          dateText: nullableString("A match date shown separately from the time (e.g. a section header 'Tomorrow' or '21 Sep'), verbatim."),
          selection: { type: ["string", "null"], enum: ["OVER", "UNDER", null], description: "The highlighted pick: OVER or UNDER. Null if not shown." },
          pointsLine: nullableNumber("The total points line for the OVER/UNDER pick, e.g. 74.5. Null if not shown."),
          ouStats: nullableString("The O/U record exactly as shown, two integers separated by '/', e.g. '20/9'."),
          ouHitRate: nullableNumber("The O/U hit-rate percentage as a number without the % sign, e.g. 69."),
          edge: nullableNumber("The EDGE percentage as a number without the % sign, e.g. 47. May be negative."),
          confidence: nullableNumber("Your confidence from 0 to 1 that this entry was transcribed correctly."),
        },
        required: [
          "player1",
          "player2",
          "competition",
          "timeText",
          "dateText",
          "selection",
          "pointsLine",
          "ouStats",
          "ouHitRate",
          "edge",
          "confidence",
        ],
      },
    },
  },
  required: ["layout", "visibleClock", "visibleDate", "timezoneText", "matches"],
} as const;

export const EXTRACTION_PROMPT = `You are a precise data-extraction engine reading screenshots from table tennis betting/statistics apps.

Extract every distinct table tennis match visible in the image and return JSON that follows the provided schema.

Rules:
- Transcribe only what is visible. NEVER guess, infer or fabricate. If a value is not clearly visible, return null for it.
- Screenshots may contain only part of the information (for example statistics without times, or times without statistics). Return the parts that are visible and null for the rest.
- Copy player names and competition names exactly as written (keep abbreviations like "Varcl J").
- Copy start time text verbatim, including words like "Today", "Tomorrow", "Starts in 45 minutes". Do not convert times, do not compute dates, do not change formats.
- If matches are grouped under a date header (e.g. "Tomorrow" or "21 Sep"), put that header in dateText for each match in the group.
- selection is OVER or UNDER only when the screenshot shows that pick (labels like "OVER", "UNDER", "O 74.5", "U 74.5"). Otherwise null.
- pointsLine is the numeric total points line of the pick if shown (e.g. "OVER 74.5" -> 74.5).
- ouStats is the O/U record such as "20/9" (two integers separated by a slash). ouHitRate is its percentage (e.g. 69). edge is the EDGE percentage (e.g. 47). Numbers only, without "%".
- visibleClock is the device's status-bar clock (top of a phone screenshot), not a match time.
- timezoneText only if a timezone label is explicitly printed next to match times.
- Do not merge different matches. Do not duplicate the same match.
- If no table tennis match information is visible, return an empty matches array.`;
