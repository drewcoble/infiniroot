import { processEnv } from "../../lib/env";

/**
 * Yahoo Fantasy Sports API (https://developer.yahoo.com/fantasysports/guide/).
 * Unlike Sleeper, every call needs an OAuth 2.0 access token scoped to a
 * signed-in Yahoo account that's actually a member of the league being
 * queried - see YAHOO.md at the project root for the app-registration steps
 * (Client ID/Secret, redirect URI) this depends on, and for which pieces of
 * this file are still unverified against a real live response.
 */
const AUTHORIZE_URL = "https://api.login.yahoo.com/oauth2/request_auth";
const TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token";
export const YAHOO_API_BASE_URL = "https://fantasysports.yahooapis.com/fantasy/v2";

export function requireYahooEnv() {
  const clientId = processEnv?.YAHOO_CLIENT_ID?.trim();
  const clientSecret = processEnv?.YAHOO_CLIENT_SECRET?.trim();
  const redirectUri = processEnv?.YAHOO_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "YAHOO_CLIENT_ID / YAHOO_CLIENT_SECRET / YAHOO_REDIRECT_URI are not " +
        "fully set - see YAHOO.md at the project root for setup steps.",
    );
  }
  return { clientId, clientSecret, redirectUri };
}

// Where the /yahoo/callback HTTP route (convex/http.ts) sends the browser
// back to once the OAuth round trip is done - the frontend's own origin,
// which is NOT the same as this Convex deployment's .convex.site domain.
// See YAHOO.md for what to set this to in each environment.
export function requireAppBaseUrl(): string {
  const value = processEnv?.APP_BASE_URL?.trim();
  if (!value) {
    throw new Error(
      "APP_BASE_URL is not set - see YAHOO.md at the project root.",
    );
  }
  return value.replace(/\/$/, "");
}

export function buildYahooAuthorizeUrl(state: string): string {
  const { clientId, redirectUri } = requireYahooEnv();
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  url.searchParams.set("language", "en-us");
  return url.toString();
}

export interface YahooTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

async function requestYahooTokens(
  body: Record<string, string>,
): Promise<YahooTokenResponse> {
  const { clientId, clientSecret } = requireYahooEnv();
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      // Yahoo's token endpoint authenticates the app via HTTP Basic auth
      // (client_id:client_secret), not a body param - per general knowledge
      // of the OAuth2 spec Yahoo follows here. Verify against a real
      // exchange - see YAHOO.md.
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams(body).toString(),
  });
  if (!response.ok) {
    const responseBody = await response.text().catch(() => "");
    throw new Error(
      `Yahoo token request failed: ${response.status} ${response.statusText}` +
        (responseBody ? ` - ${responseBody}` : ""),
    );
  }
  return await response.json();
}

export async function exchangeYahooCode(
  code: string,
): Promise<YahooTokenResponse> {
  const { redirectUri } = requireYahooEnv();
  return await requestYahooTokens({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
}

export async function refreshYahooTokens(
  refreshToken: string,
): Promise<YahooTokenResponse> {
  const { redirectUri } = requireYahooEnv();
  return await requestYahooTokens({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    redirect_uri: redirectUri,
  });
}

// Authenticated GET against the Fantasy Sports API, requesting JSON (Yahoo
// defaults to XML). Yahoo's JSON is a direct translation of its XML shape -
// notoriously full of numeric-string-keyed pseudo-arrays (e.g.
// `{"0": {...}, "1": {...}, "count": 2}` instead of a plain array) - callers
// in convex/infinidraft/yahoo/league.ts parse defensively and are flagged as unverified
// until checked against a real response. See YAHOO.md.
export async function fetchYahooApi<T>(
  accessToken: string,
  path: string,
): Promise<T> {
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(
    `${YAHOO_API_BASE_URL}${path}${separator}format=json`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Yahoo API request failed: ${response.status} ${response.statusText}` +
        (body ? ` - ${body}` : ""),
    );
  }
  return await response.json();
}

/**
 * Yahoo's `?format=json` output is a direct translation of its XML schema -
 * NOT verified against a live response (see YAHOO.md). From general
 * knowledge, a resource's fields typically arrive as an array of small
 * single-key objects to be merged (`[{"league_key": "..."}, {"name": "..."}, ...]`),
 * and collections arrive as an object keyed by stringified index plus a
 * "count" field (`{"0": {...}, "1": {...}, "count": 2}`) instead of a plain
 * JSON array. The two helpers below are written to be resilient to that
 * shape rather than assuming one exact path, since a wrong guess at an exact
 * path would silently return nothing instead of a clear error - but they
 * still need a real authenticated response to confirm against. Shared by
 * every caller in convex/infinidraft/yahoo/league.ts and convex/infinidraft/yahoo/leagueSettingsMapping.ts.
 */

// Merges an array of small field objects (Yahoo's field-list pattern) into
// one - no-op passthrough for anything not shaped that way.
export function mergeYahooFields(node: unknown): Record<string, unknown> {
  if (Array.isArray(node)) {
    const merged: Record<string, unknown> = {};
    for (const entry of node) {
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        Object.assign(merged, entry);
      }
    }
    return merged;
  }
  if (node && typeof node === "object") {
    return node as Record<string, unknown>;
  }
  return {};
}

// Recursively finds every node that appears as the value of `key` at any
// depth in a Yahoo JSON tree - e.g. findNodesByKey(json, "league") finds
// every league resource regardless of how deeply the surrounding
// users/games/leagues wrapper nests it.
export function findNodesByKey(node: unknown, key: string): unknown[] {
  const found: unknown[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value && typeof value === "object") {
      for (const [k, v2] of Object.entries(value as Record<string, unknown>)) {
        if (k === key) found.push(v2);
        else visit(v2);
      }
    }
  };
  visit(node);
  return found;
}
