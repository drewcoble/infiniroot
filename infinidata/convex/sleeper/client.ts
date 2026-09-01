export {
  requireSuperAdmin,
  currentSeason,
} from "../fantasyPros/client";

/**
 * Undocumented Sleeper endpoint (not in https://docs.sleeper.com/, which only
 * covers Sleeper's own league-management API - no projections/rankings
 * exist there at all). Discovered and verified live:
 * https://api.sleeper.com/projections/nfl/{season}[/{week}]?season_type=regular&position[]=X
 * No API key. Real position filtering (unlike FantasyPros), no pagination
 * cap (full player pools returned in one call). Risk: unofficial, could
 * change or disappear without notice, no formal rate-limit policy (community
 * rule of thumb: stay under ~1000 req/min).
 */
const API_BASE_URL = "https://api.sleeper.com";

// Sleeper uses "DEF" for team defense; our schema/UI use "DST" everywhere -
// translate only at this fetch boundary.
export const POSITION_SLUGS: Record<
  "QB" | "RB" | "WR" | "TE" | "DST" | "K",
  string
> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  DST: "DEF",
  K: "K",
};

// Sleeper's DEF player_id is a team abbreviation string (e.g. "ARI"), not a
// number, but our schema's fpid is v.number() everywhere. Reproducing
// FantasyPros' own DST numbering wasn't reliable (verified it has undocumented
// exceptions - the LA teams break its alphabetical pattern), so these are our
// own synthetic ids, deliberately out of range of any real player id we've
// seen. Confirmed live: exactly these 32 abbreviations.
const DEF_TEAMS = [
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE",
  "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC",
  "LAC", "LAR", "LV", "MIA", "MIN", "NE", "NO", "NYG",
  "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS",
] as const;

export const DEF_TEAM_FPIDS: Record<string, number> = Object.fromEntries(
  DEF_TEAMS.map((team, index) => [team, 90001 + index]),
);

// "projections" -> pre-game estimates (category: "proj" in the response).
// "stats" -> actual results after games are played (category: "stat").
// Same query shape either way, just a different path prefix.
export async function fetchSleeper(
  endpoint: "projections" | "stats",
  season: string,
  week: string | undefined,
  positions: string[],
  // Untyped fetch boundary - callers cast the JSON response to whatever
  // specific record shape they expect (SleeperProjectionRecord[], etc).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const path = week
    ? `/${endpoint}/nfl/${season}/${week}`
    : `/${endpoint}/nfl/${season}`;
  const url = new URL(`${API_BASE_URL}${path}`);
  url.searchParams.set("season_type", "regular");
  for (const position of positions) {
    url.searchParams.append("position[]", position);
  }

  const response = await fetch(url.toString());

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Sleeper API request failed: ${response.status} ${response.statusText}` +
        (body ? ` - ${body}` : ""),
    );
  }

  return await response.json();
}
