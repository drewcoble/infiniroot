import { processEnv } from "../lib/env";

/**
 * TypeSafe AI's "System One" evaluation API (model: Jev) - see
 * https://docs.typesafe.ai/api.md. Send a `state` plus a map of typed
 * questions (noul = yes/no probability, choice = one of N options, score =
 * rating across 2-10 ordered levels); every question is answered in one
 * call. Called over plain HTTP rather than their JS SDK to avoid adding a
 * dependency for a POC. Server-side only: api.typesafe.ai doesn't return
 * CORS headers for browser origins, and the key must stay out of the bundle.
 */
const API_URL = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-latest";

export type JevQuestion =
  | { type: "noul"; instructions: string; criteria?: { true?: string; false?: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string | null> }
  | { type: "score"; instructions: string; criteria: string[] };

export type JevAnswer =
  | { type: "noul"; noul: number }
  | {
      type: "choice";
      choice: string;
      probabilities: Record<string, number>;
      confidence: number;
    }
  | {
      type: "score";
      score: number;
      legend: Record<string, string>;
      probabilities: Record<string, number>;
      confidence: number;
    };

export interface JevResponse {
  model: string;
  answers: Record<string, JevAnswer>;
  usage: { input_tokens: number; output_tokens: number };
}

function requireApiKey(): string {
  const key = processEnv?.JEV_API_KEY;
  if (!key) {
    throw new Error("JEV_API_KEY is not set - set it as a Convex env var.");
  }
  return key;
}

export async function askJev(
  state: unknown,
  questions: Record<string, JevQuestion>,
): Promise<JevResponse> {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ state, model: MODEL, questions }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Jev request failed: ${response.status} ${response.statusText}` +
        (body ? ` - ${body}` : ""),
    );
  }
  return (await response.json()) as JevResponse;
}
