/**
 * Official FantasyPros API (https://api.fantasypros.com/v2/docs). Requires an
 * API key from an MVP/HOF FantasyPros membership - see
 * https://support.fantasypros.com/hc/en-us/articles/49749297704475.
 *
 * Player identity, projections, and rankings now come from Sleeper instead
 * (see convex/sleeper/) - FantasyPros' /nfl/players position filter turned
 * out to be broken (every value tried returned the same unfiltered ~8500-entry
 * set) and /nfl/{season}/projections silently caps at 10 players/page with no
 * documented way around it. This client is only used by news/injuries/
 * playerPoints now, which still work fine here.
 */
const API_BASE_URL = "https://api.fantasypros.com/public/v2/json";

export const processEnv = (
  globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }
).process?.env;

export function requireApiKey() {
  const apiKey = processEnv?.FANTASYPROS_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "FANTASYPROS_API_KEY is not set. Once your API key request is approved, " +
        "run `npx convex env set FANTASYPROS_API_KEY <key>`.",
    );
  }
  return apiKey;
}

export async function fetchFantasyPros(
  path: string,
  params: Record<string, string | undefined>,
  // Untyped fetch boundary - callers cast the JSON response to whatever
  // specific record shape they expect.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const apiKey = requireApiKey();
  const url = new URL(`${API_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url.toString(), {
    headers: { "x-api-key": apiKey },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `FantasyPros API request failed: ${response.status} ${response.statusText}` +
        (body ? ` - ${body}` : ""),
    );
  }

  return await response.json();
}

// FantasyPros datetimes come back as "2026-06-24 15:30:14" - UTC, no offset.
export function parseUtcDateTime(value: string): number {
  return new Date(`${value.replace(" ", "T")}Z`).getTime();
}

// Confirmed against a live /nfl/{season}/projections call: the API wants the
// position uppercase (matching the position_id it echoes back in responses),
// not lowercase - a lowercase value silently returns zero players.
export const POSITION_SLUGS: Record<
  "QB" | "RB" | "WR" | "TE" | "DST",
  string
> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  DST: "DST",
};
