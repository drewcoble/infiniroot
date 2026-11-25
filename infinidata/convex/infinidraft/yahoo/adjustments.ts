import type { ActionCtx } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";
import { fetchYahooApi, findNodesByKey, mergeYahooFields } from "./client";
import { withYahooToken } from "./oauth";
import { cachedYahoo } from "./cache";

// A past week's scores - an hour, so a commissioner's late edit still
// shows up the same day. The live week's lag behind its games a little.
const PAST_WEEK_CACHE_MS = 60 * 60 * 1000;
const LIVE_WEEK_CACHE_MS = 2 * 60 * 1000;

// Not in the starting lineup.
const NON_STARTER_POSITIONS = new Set(["BN", "IR", "IR+", "NA"]);

// Provider team key -> points.
type TeamPoints = Record<string, number>;

export interface YahooWeekScores {
  // Yahoo's own matchup score - commissioner point adjustments included.
  totals: TeamPoints;
  // The starters' player_points summed - no adjustments.
  starters: TeamPoints;
}

// Each team's points for the week, matchup or not - the league's
// teams/stats resource (documented Yahoo fields, NOT confirmed against a
// live response - see YAHOO.md).
export async function fetchYahooTeamWeekTotals(
  accessToken: string,
  leagueKey: string,
  week: number,
): Promise<TeamPoints> {
  const json = await fetchYahooApi<unknown>(
    accessToken,
    `/league/${leagueKey}/teams/stats;type=week;week=${week}`,
  );
  const points: TeamPoints = {};
  for (const node of findNodesByKey(json, "team")) {
    const fields = mergeYahooFields(node);
    if (typeof fields.team_key !== "string") continue;
    const total = Number(mergeYahooFields(fields.team_points).total);
    if (Number.isFinite(total)) points[fields.team_key] = total;
  }
  return points;
}

// One team's starters' points for the week - the same roster request
// infinileague's lineups use (see teamRoster.ts), NOT confirmed against a
// live response.
async function fetchYahooStarterPoints(
  accessToken: string,
  teamKey: string,
  week: number,
): Promise<number> {
  const json = await fetchYahooApi<unknown>(
    accessToken,
    `/team/${teamKey}/roster;week=${week}/players/stats;type=week;week=${week}`,
  );
  let points = 0;
  for (const node of findNodesByKey(json, "player")) {
    const fields = mergeYahooFields(node);
    const position = mergeYahooFields(fields.selected_position).position;
    if (typeof position !== "string" || NON_STARTER_POSITIONS.has(position)) continue;
    const total = Number(mergeYahooFields(fields.player_points).total);
    if (Number.isFinite(total)) points += total;
  }
  return points;
}

// Every team's Yahoo score and starters' points for one week, fetched
// together so a live game can't move one without the other. Their
// difference is whatever a commissioner added by hand.
export async function loadYahooWeekScores(
  ctx: ActionCtx,
  season: Doc<"seasons">,
  league: Doc<"leagues">,
  teams: Doc<"seasonTeams">[],
  week: number,
  currentWeek: number,
): Promise<YahooWeekScores> {
  const leagueKey = season.yahooLeagueKey;
  if (!leagueKey) return { totals: {}, starters: {} };
  const teamKeys = teams.flatMap((team) => (team.yahooTeamKey ? [team.yahooTeamKey] : []));
  return await cachedYahoo(
    ctx,
    `weekScores:yahoo:${leagueKey}:${week}`,
    week < currentWeek ? PAST_WEEK_CACHE_MS : LIVE_WEEK_CACHE_MS,
    () =>
      withYahooToken(ctx, league.ownerId, async (token) => {
        const [totals, starterPoints] = await Promise.all([
          fetchYahooTeamWeekTotals(token, leagueKey, week),
          Promise.all(teamKeys.map((teamKey) => fetchYahooStarterPoints(token, teamKey, week))),
        ]);
        const starters = Object.fromEntries(teamKeys.map((key, i) => [key, starterPoints[i]!]));
        return { totals, starters };
      }),
  );
}

// teamKey -> Yahoo's total less its starters' points, where they differ.
export function yahooAdjustments(scores: YahooWeekScores): TeamPoints {
  const adjustments: TeamPoints = {};
  for (const [teamKey, total] of Object.entries(scores.totals)) {
    const starters = scores.starters[teamKey];
    if (starters === undefined) continue;
    const adjustment = Math.round((total - starters) * 100) / 100;
    if (adjustment !== 0) adjustments[teamKey] = adjustment;
  }
  return adjustments;
}
