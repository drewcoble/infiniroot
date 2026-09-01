import { processEnv } from "../fantasyPros/client";

/**
 * Google AI Studio / Gemini API (https://ai.google.dev/gemini-api/docs).
 * Free tier, no billing account required - see GEMINI.md at the project
 * root for how to get a key. Used only by convex/gemini/reportSummary.ts to
 * write the Draft Report Card's AI recap.
 *
 * gemini-3.6-flash is Google's current default/recommended model and is
 * free-tier eligible as of this writing - Google's free-tier lineup shifts
 * over time (see GEMINI.md's "things to verify"), so if this model ever
 * stops being served, swap it here.
 */
export const MODEL = "gemini-3.6-flash";
const API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export function requireGeminiApiKey(): string {
  const apiKey = processEnv?.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. See GEMINI.md at the project root for how " +
        "to get a free key, then run `npx convex env set GEMINI_API_KEY <key>`.",
    );
  }
  return apiKey;
}

interface GenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
}

// generateContent is the classic, still-fully-supported Gemini REST
// endpoint (there's also a newer "Interactions API", but generateContent's
// wire format is simpler to hand-roll and matches every other integration
// in this codebase's plain-fetch convention - see fetchFantasyPros/
// fetchSleeper/fetchYahooApi). maxOutputTokens bounds cost/length; this
// isn't a chat, just a single free-form recap.
export async function generateGeminiText(
  prompt: string,
  options?: {
    // Default (600) fits the original single-paragraph recap. The
    // structured per-team-summaries response (see reportSummary.ts) needs
    // a much bigger budget, so callers generating that pass their own.
    maxOutputTokens?: number;
    // When set, forces the response to valid JSON matching this (OpenAPI
    // subset) schema instead of free-form prose - see
    // https://ai.google.dev/gemini-api/docs/structured-output.
    responseSchema?: Record<string, unknown>;
  },
): Promise<string> {
  const apiKey = requireGeminiApiKey();
  const url = `${API_BASE_URL}/models/${MODEL}:generateContent?key=${apiKey}`;
  const { maxOutputTokens = 600, responseSchema } = options ?? {};

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens,
        // gemini-3.6-flash "thinks" before answering by default, and those
        // thinking tokens are drawn from the same maxOutputTokens budget as
        // the visible answer - confirmed live: without this, a 400-token
        // budget got fully consumed by thinking and the recap came back cut
        // off after one sentence. This is a pure recap, not a reasoning
        // task, so there's nothing worth spending that budget on.
        //
        // Only applied without a responseSchema, though - confirmed live
        // that gemini-3.6-flash rejects thinkingBudget: 0 combined with
        // structured JSON output (responseMimeType/responseSchema below)
        // with a bare 400 INVALID_ARGUMENT. The JSON path's maxOutputTokens
        // is sized generously enough to absorb the model's default thinking
        // budget on top of the actual answer.
        ...(responseSchema ? {} : { thinkingConfig: { thinkingBudget: 0 } }),
        ...(responseSchema
          ? { responseMimeType: "application/json", responseSchema }
          : {}),
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Gemini API request failed: ${response.status} ${response.statusText}` +
        (body ? ` - ${body}` : ""),
    );
  }

  const json: GenerateContentResponse = await response.json();
  if (json.promptFeedback?.blockReason) {
    throw new Error(
      `Gemini API response blocked: ${json.promptFeedback.blockReason}`,
    );
  }

  const candidate = json.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Gemini API returned no text in its response");
  }
  // Fail loudly rather than caching/showing a sentence that stops mid-
  // thought - the caller (generateReportSummary) already treats any thrown
  // error as best-effort-failed and falls back to the free templated recap.
  if (candidate?.finishReason === "MAX_TOKENS") {
    throw new Error(
      "Gemini API response was truncated (hit maxOutputTokens)",
    );
  }
  return text;
}
