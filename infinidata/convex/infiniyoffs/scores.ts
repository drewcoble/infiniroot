import type { ActionCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { fetchSleeperJson } from "../sleeper/league";
import { fetchEspnLeague } from "../espn/league";
import { withYahooToken } from "../infinidraft/yahoo/oauth";
import { cachedYahoo } from "../infinidraft/yahoo/cache";
import { fetchYahooTeamWeekTotals, loadYahooWeekScores } from "../infinidraft/yahoo/adjustments";

// Every team's actual points per week, straight from the platform - the
// raw input infiniyoffs' rules engine scores a custom format from. Past
// weeks are final and cached for a week; the current week is live and
// cached briefly.
const PAST_WEEK_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const LIVE_WEEK_CACHE_MS = 2 * 60 * 1000;
// Yahoo throttles (see infinidraft/yahoo/cache.ts), so its live week
// lags a little more.
const YAHOO_LIVE_WEEK_CACHE_MS = 5 * 60 * 1000;

// Provider team id -> points.
type WeekPoints = Record<string, number>;

interface SleeperWeekEntry {
  roster_id: number;
  points?: number;
}

async function sleeperWeek(leagueId: string, week: number): Promise<WeekPoints> {
  const rows = await fetchSleeperJson<SleeperWeekEntry[]>(`/league/${leagueId}/matchups/${week}`);
  return Object.fromEntries((rows ?? []).map((row) => [String(row.roster_id), row.points ?? 0]));
}

interface EspnSide {
  teamId: number;
  pointsByScoringPeriod?: Record<string, number>;
}

// ESPN's schedule carries each side's points per NFL week - confirmed live
// on league 164483. A team with no game that week has no score here.
async function espnWeeks(espnLeagueId: string, year: string): Promise<Record<number, WeekPoints>> {
  const league = await fetchEspnLeague(espnLeagueId, year, ["mMatchupScore"]);
  const byWeek: Record<number, WeekPoints> = {};
  for (const entry of league.schedule ?? []) {
    for (const side of [entry.home, entry.away] as (EspnSide | undefined)[]) {
      if (!side) continue;
      for (const [week, points] of Object.entries(side.pointsByScoringPeriod ?? {})) {
        (byWeek[Number(week)] ??= {})[String(side.teamId)] = points;
      }
    }
  }
  return byWeek;
}

// teamId -> week -> points, weeks 1 through `throughWeek`. Yahoo weeks
// after `rawAfterWeek` (a custom format's playoffs) are the starters'
// points alone - a commissioner's points added by hand in Yahoo would
// double up the format's own bonuses.
export async function loadWeeklyPoints(
  ctx: ActionCtx,
  season: Doc<"seasons">,
  league: Doc<"leagues">,
  teams: Doc<"seasonTeams">[],
  currentWeek: number,
  throughWeek: number,
  rawAfterWeek?: number,
): Promise<Record<string, Record<number, number>>> {
  const weeks = Array.from({ length: Math.max(throughWeek, 0) }, (_, i) => i + 1);
  const cacheMs = (week: number, liveMs: number) =>
    week < currentWeek ? PAST_WEEK_CACHE_MS : liveMs;
  let byWeek: Record<number, WeekPoints>;
  let teamIdByProviderId: Map<string, Id<"seasonTeams">>;

  if (season.sleeperLeagueId) {
    const leagueId = season.sleeperLeagueId;
    const rows = await Promise.all(
      weeks.map((week) =>
        cachedYahoo(
          ctx,
          `yoffs:points:sleeper:${leagueId}:${week}`,
          cacheMs(week, LIVE_WEEK_CACHE_MS),
          () => sleeperWeek(leagueId, week),
        ),
      ),
    );
    byWeek = Object.fromEntries(rows.map((points, i) => [weeks[i]!, points]));
    teamIdByProviderId = new Map(
      teams.flatMap((team) => (team.sleeperRosterId ? [[team.sleeperRosterId, team._id]] : [])),
    );
  } else if (season.yahooLeagueKey) {
    const leagueKey = season.yahooLeagueKey;
    const rows = await Promise.all(
      weeks.map(async (week) =>
        rawAfterWeek !== undefined && week > rawAfterWeek && week <= currentWeek
          ? (await loadYahooWeekScores(ctx, season, league, teams, week, currentWeek)).starters
          : cachedYahoo(
              ctx,
              `yoffs:points:yahoo:${leagueKey}:${week}`,
              cacheMs(week, YAHOO_LIVE_WEEK_CACHE_MS),
              () =>
                withYahooToken(ctx, league.ownerId, (token) =>
                  fetchYahooTeamWeekTotals(token, leagueKey, week),
                ),
            ),
      ),
    );
    byWeek = Object.fromEntries(rows.map((points, i) => [weeks[i]!, points]));
    teamIdByProviderId = new Map(
      teams.flatMap((team) => (team.yahooTeamKey ? [[team.yahooTeamKey, team._id]] : [])),
    );
  } else if (season.espnLeagueId) {
    const espnLeagueId = season.espnLeagueId;
    byWeek = await cachedYahoo(
      ctx,
      `yoffs:points:espn:${espnLeagueId}:${season.year}`,
      LIVE_WEEK_CACHE_MS,
      () => espnWeeks(espnLeagueId, season.year),
    );
    teamIdByProviderId = new Map(
      teams.flatMap((team) => (team.espnTeamId ? [[team.espnTeamId, team._id]] : [])),
    );
  } else {
    throw new Error("This league isn't linked to Sleeper, Yahoo, or ESPN yet.");
  }

  const result: Record<string, Record<number, number>> = {};
  for (const week of weeks) {
    // A future week has no points yet - Sleeper lists every roster at 0.
    if (week > currentWeek) continue;
    for (const [providerId, points] of Object.entries(byWeek[week] ?? {})) {
      const teamId = teamIdByProviderId.get(providerId);
      if (teamId) (result[teamId] ??= {})[week] = points;
    }
  }
  return result;
}
