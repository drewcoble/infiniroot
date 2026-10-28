import type { ActionCtx } from "../../_generated/server";
import { Doc, Id } from "../../_generated/dataModel";
import { fetchSleeperJson, fetchSleeperLeagueSettings } from "../../sleeper/league";
import { fetchEspnRegularSeasonMatchups } from "../../espn/league";
import {
  fetchYahooLeagueSettings,
  fetchYahooWeekPairs,
  yahooRegularSeasonEndWeek,
} from "../../infinidraft/yahoo/league";
import { withYahooToken } from "../../infinidraft/yahoo/oauth";
import { cachedYahoo } from "../../infinidraft/yahoo/cache";
import type { SleeperMatchupEntry } from "./teamRoster";

// Commissioners can edit a schedule mid-season, so it's only reused for an
// hour - mostly to spare Yahoo repeat scoreboard reads (see
// infinidraft/yahoo/cache.ts).
const SCHEDULE_CACHE_MS = 60 * 60 * 1000;

// A finished week's pairings can't change any more.
const PAST_WEEK_PAIRS_CACHE_MS = 7 * 24 * 60 * 60 * 1000;

// Last NFL regular-season week - the fallback end for a league with no
// playoffs.
const LAST_NFL_WEEK = 18;

export interface ScheduledMatchup {
  // The NFL weeks this matchup is decided over - one, except in an ESPN
  // league with multi-week matchup periods.
  weeks: number[];
  teamIds: [Id<"seasonTeams">, Id<"seasonTeams">];
}

export interface LeagueSchedule {
  regularSeasonEndWeek: number;
  // Every team also plays the league median each week (Sleeper's
  // league_average_match).
  medianGame: boolean;
  matchups: ScheduledMatchup[];
}

// The cached, provider-native form - team ids as the provider knows them,
// resolved to seasonTeams ids per call so the cache never holds stale ids.
interface ProviderSchedule {
  regularSeasonEndWeek: number;
  medianGame: boolean;
  matchups: { weeks: number[]; teams: [string, string] }[];
}

function weekRange(fromWeek: number, toWeek: number): number[] {
  return Array.from({ length: Math.max(toWeek - fromWeek + 1, 0) }, (_, i) => fromWeek + i);
}

// Sleeper groups each matchup's two roster_ids under one matchup_id.
function sleeperPairs(entries: SleeperMatchupEntry[]): [string, string][] {
  const rosterIdsByMatchup = new Map<number, string[]>();
  for (const entry of entries) {
    if (entry.matchup_id === null || entry.matchup_id === undefined) continue;
    const rosterIds = rosterIdsByMatchup.get(entry.matchup_id) ?? [];
    rosterIds.push(String(entry.roster_id));
    rosterIdsByMatchup.set(entry.matchup_id, rosterIds);
  }
  return [...rosterIdsByMatchup.values()]
    .filter((rosterIds) => rosterIds.length === 2)
    .map((rosterIds) => [rosterIds[0]!, rosterIds[1]!]);
}

function sleeperRegularSeasonEndWeek(playoffWeekStart: number | undefined): number {
  return playoffWeekStart !== undefined && playoffWeekStart > 1
    ? playoffWeekStart - 1
    : LAST_NFL_WEEK;
}

async function fetchSleeperSchedule(leagueId: string, fromWeek: number): Promise<ProviderSchedule> {
  const settings = await fetchSleeperLeagueSettings(leagueId);
  const regularSeasonEndWeek = sleeperRegularSeasonEndWeek(settings.settings?.playoff_week_start);
  const weeks = weekRange(fromWeek, regularSeasonEndWeek);
  const entriesByWeek = await Promise.all(
    weeks.map((week) =>
      fetchSleeperJson<SleeperMatchupEntry[]>(`/league/${leagueId}/matchups/${week}`),
    ),
  );
  const matchups = entriesByWeek.flatMap((entries, i) =>
    sleeperPairs(entries).map((teams) => ({ weeks: [weeks[i]!], teams })),
  );
  return {
    regularSeasonEndWeek,
    medianGame: settings.settings?.league_average_match === 1,
    matchups,
  };
}

async function fetchEspnSchedule(espnLeagueId: string, year: string): Promise<ProviderSchedule> {
  const matchups = await fetchEspnRegularSeasonMatchups(espnLeagueId, year);
  const lastWeek = Math.max(0, ...matchups.flatMap((matchup) => matchup.weeks));
  return {
    regularSeasonEndWeek: lastWeek > 0 ? lastWeek : LAST_NFL_WEEK,
    medianGame: false,
    matchups,
  };
}

async function fetchYahooSchedule(
  accessToken: string,
  leagueKey: string,
  fromWeek: number,
): Promise<ProviderSchedule> {
  const settings = await fetchYahooLeagueSettings(accessToken, leagueKey);
  const regularSeasonEndWeek = yahooRegularSeasonEndWeek(settings.raw);
  if (regularSeasonEndWeek === null) {
    throw new Error("Couldn't find this league's playoff start week on Yahoo.");
  }
  const weeks = weekRange(fromWeek, regularSeasonEndWeek);
  const pairsByWeek = await Promise.all(
    weeks.map((week) => fetchYahooWeekPairs(accessToken, leagueKey, week)),
  );
  return {
    regularSeasonEndWeek,
    medianGame: false,
    matchups: pairsByWeek.flatMap((pairs, i) =>
      pairs.map((teams) => ({ weeks: [weeks[i]!], teams })),
    ),
  };
}

// The league's regular-season schedule from `fromWeek` on (ESPN returns the
// whole season regardless), fetched live from the provider and reused for
// up to an hour. Matchups whose teams aren't linked to a seasonTeams row are
// dropped.
export async function loadLeagueSchedule(
  ctx: ActionCtx,
  season: Doc<"seasons">,
  league: Doc<"leagues">,
  teams: Doc<"seasonTeams">[],
  fromWeek: number,
): Promise<LeagueSchedule> {
  let schedule: ProviderSchedule;
  let teamIdByProviderId: Map<string, Id<"seasonTeams">>;

  if (season.sleeperLeagueId) {
    const leagueId = season.sleeperLeagueId;
    schedule = await cachedYahoo(ctx, `schedule:sleeper:${leagueId}`, SCHEDULE_CACHE_MS, () =>
      fetchSleeperSchedule(leagueId, fromWeek),
    );
    teamIdByProviderId = new Map(
      teams.flatMap((team) => (team.sleeperRosterId ? [[team.sleeperRosterId, team._id]] : [])),
    );
  } else if (season.yahooLeagueKey) {
    const leagueKey = season.yahooLeagueKey;
    schedule = await cachedYahoo(ctx, `schedule:yahoo:${leagueKey}`, SCHEDULE_CACHE_MS, () =>
      withYahooToken(ctx, league.ownerId, (accessToken) =>
        fetchYahooSchedule(accessToken, leagueKey, fromWeek),
      ),
    );
    teamIdByProviderId = new Map(
      teams.flatMap((team) => (team.yahooTeamKey ? [[team.yahooTeamKey, team._id]] : [])),
    );
  } else if (season.espnLeagueId) {
    const espnLeagueId = season.espnLeagueId;
    schedule = await cachedYahoo(
      ctx,
      `schedule:espn:${espnLeagueId}:${season.year}`,
      SCHEDULE_CACHE_MS,
      () => fetchEspnSchedule(espnLeagueId, season.year),
    );
    teamIdByProviderId = new Map(
      teams.flatMap((team) => (team.espnTeamId ? [[team.espnTeamId, team._id]] : [])),
    );
  } else {
    throw new Error("This league isn't linked to Sleeper, Yahoo, or ESPN yet.");
  }

  const matchups: ScheduledMatchup[] = [];
  for (const matchup of schedule.matchups) {
    const a = teamIdByProviderId.get(matchup.teams[0]);
    const b = teamIdByProviderId.get(matchup.teams[1]);
    if (a && b) matchups.push({ weeks: matchup.weeks, teamIds: [a, b] });
  }
  return {
    regularSeasonEndWeek: schedule.regularSeasonEndWeek,
    medianGame: schedule.medianGame,
    matchups,
  };
}

// One week's provider-native pairings, plus where the regular season ends.
interface ProviderWeekPairs {
  regularSeasonEndWeek: number;
  pairs: [string, string][];
}

// One regular-season week's pairings, any week past or future - for the
// Matchup tab's league view. Empty for a playoff week: Sleeper pre-fills
// placeholder playoff pairings (see sleeper/league.ts's playoff_week_start),
// so playoff weeks aren't trusted on any provider. ESPN reads the same
// cached season schedule loadLeagueSchedule does; Sleeper/Yahoo cache each
// week on its own - a past week for a week, otherwise an hour.
export async function loadWeekPairs(
  ctx: ActionCtx,
  season: Doc<"seasons">,
  league: Doc<"leagues">,
  teams: Doc<"seasonTeams">[],
  week: number,
  currentWeek: number,
): Promise<{ isPlayoffWeek: boolean; pairs: [Id<"seasonTeams">, Id<"seasonTeams">][] }> {
  const maxAgeMs = week < currentWeek ? PAST_WEEK_PAIRS_CACHE_MS : SCHEDULE_CACHE_MS;
  let weekPairs: ProviderWeekPairs;
  let teamIdByProviderId: Map<string, Id<"seasonTeams">>;

  if (season.sleeperLeagueId) {
    const leagueId = season.sleeperLeagueId;
    weekPairs = await cachedYahoo(ctx, `pairs:sleeper:${leagueId}:${week}`, maxAgeMs, async () => {
      const [settings, entries] = await Promise.all([
        fetchSleeperLeagueSettings(leagueId),
        fetchSleeperJson<SleeperMatchupEntry[]>(`/league/${leagueId}/matchups/${week}`),
      ]);
      return {
        regularSeasonEndWeek: sleeperRegularSeasonEndWeek(settings.settings?.playoff_week_start),
        pairs: sleeperPairs(entries),
      };
    });
    teamIdByProviderId = new Map(
      teams.flatMap((team) => (team.sleeperRosterId ? [[team.sleeperRosterId, team._id]] : [])),
    );
  } else if (season.yahooLeagueKey) {
    const leagueKey = season.yahooLeagueKey;
    weekPairs = await cachedYahoo(ctx, `pairs:yahoo:${leagueKey}:${week}`, maxAgeMs, () =>
      withYahooToken(ctx, league.ownerId, async (accessToken) => {
        const [settings, pairs] = await Promise.all([
          fetchYahooLeagueSettings(accessToken, leagueKey),
          fetchYahooWeekPairs(accessToken, leagueKey, week),
        ]);
        const regularSeasonEndWeek = yahooRegularSeasonEndWeek(settings.raw);
        if (regularSeasonEndWeek === null) {
          throw new Error("Couldn't find this league's playoff start week on Yahoo.");
        }
        return { regularSeasonEndWeek, pairs };
      }),
    );
    teamIdByProviderId = new Map(
      teams.flatMap((team) => (team.yahooTeamKey ? [[team.yahooTeamKey, team._id]] : [])),
    );
  } else if (season.espnLeagueId) {
    const espnLeagueId = season.espnLeagueId;
    const schedule = await cachedYahoo(
      ctx,
      `schedule:espn:${espnLeagueId}:${season.year}`,
      SCHEDULE_CACHE_MS,
      () => fetchEspnSchedule(espnLeagueId, season.year),
    );
    weekPairs = {
      regularSeasonEndWeek: schedule.regularSeasonEndWeek,
      pairs: schedule.matchups
        .filter((matchup) => matchup.weeks.includes(week))
        .map((matchup) => matchup.teams),
    };
    teamIdByProviderId = new Map(
      teams.flatMap((team) => (team.espnTeamId ? [[team.espnTeamId, team._id]] : [])),
    );
  } else {
    throw new Error("This league isn't linked to Sleeper, Yahoo, or ESPN yet.");
  }

  if (week > weekPairs.regularSeasonEndWeek) return { isPlayoffWeek: true, pairs: [] };
  const pairs: [Id<"seasonTeams">, Id<"seasonTeams">][] = [];
  for (const [aKey, bKey] of weekPairs.pairs) {
    const a = teamIdByProviderId.get(aKey);
    const b = teamIdByProviderId.get(bKey);
    if (a && b) pairs.push([a, b]);
  }
  return { isPlayoffWeek: false, pairs };
}
