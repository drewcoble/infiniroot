import { v } from "convex/values";
import { action, type ActionCtx } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import { Doc, Id } from "../../_generated/dataModel";
import { fetchSleeperJson, fetchSleeperLeagueSettings } from "../../sleeper/league";
import { fetchEspnPlayoffSchedule } from "../../espn/league";
import {
  fetchYahooLeagueSettings,
  fetchYahooPlayoffGames,
  yahooPlayoffSettings,
  yahooRegularSeasonEndWeek,
} from "../../infinidraft/yahoo/league";
import { withYahooToken } from "../../infinidraft/yahoo/oauth";
import { cachedYahoo } from "../../infinidraft/yahoo/cache";
import { compareStandings } from "./standings";
import {
  bracketRoundCount,
  buildTournament,
  seededBracket,
  type ProviderBracket,
  type ProviderBracketGame,
  type Tournament,
} from "./tournaments";

// Brackets move with every result and live scores ride along, so Sleeper
// and ESPN (public, cheap) are re-read every few minutes. Yahoo gets the
// same hour as schedule.ts, to spare its throttling.
const PLAYOFFS_CACHE_MS = 5 * 60 * 1000;
const YAHOO_PLAYOFFS_CACHE_MS = 60 * 60 * 1000;

export type SeasonPhase = "regular" | "playoffs" | "complete";

// Where the bracket's teams come from: the provider's own bracket (set,
// or Sleeper's all-season projection), today's standings, or projected
// final standings.
export type BracketSeeding = "provider" | "current" | "projected";

export interface LeaguePlayoffs {
  // False for a league with no playoffs (guillotine, or turned off).
  hasPlayoffs: boolean;
  regularSeasonEndWeek: number;
  playoffTeamCount: number;
  currentWeek: number;
  phase: SeasonPhase;
  seeding: BracketSeeding;
  // Championship first. Before the provider sets the bracket it's seeded
  // from current standings - Sleeper's own, which it fills in all season,
  // else the provider's current seeds or getStandings' order - or from
  // projected final standings when asked.
  tournaments: Tournament[];
}

// The cached, provider-native form (see tournaments.ts's ProviderBracket).
interface ProviderPlayoffs {
  regularSeasonEndWeek: number;
  playoffTeamCount: number;
  // Null when the league has no playoffs.
  championship: ProviderBracket | null;
  // Every team's current seed, where the provider has one before the
  // bracket is set (ESPN).
  currentSeeds?: Record<string, number>;
}

// Sleeper's bracket endpoints - verified live (Shadynasty's 2025 and 2026):
// r = round, m = game id, t1/t2 = roster ids (null until set), w/l = the
// decided winner/loser, p = the place a placement game decides (1 on the
// final, 3/5 on the consolation games), t1_from/t2_from = the earlier game
// a spot is fed by (only given on some games).
interface SleeperBracketEntry {
  r: number;
  m: number;
  t1: number | null;
  t2: number | null;
  w: number | null;
  l: number | null;
  p?: number;
  t1_from?: { w?: number; l?: number };
  t2_from?: { w?: number; l?: number };
}

interface SleeperWeekPoints {
  roster_id: number;
  points?: number;
}

// Weeks each round runs, from playoff_round_type (see sleeper/league.ts).
function sleeperRoundWeeks(startWeek: number, roundCount: number, roundType: number): number[][] {
  return Array.from({ length: roundCount }, (_, i) => {
    if (roundType === 2) return [startWeek + 2 * i, startWeek + 2 * i + 1];
    const week = startWeek + i;
    return roundType === 1 && i === roundCount - 1 ? [week, week + 1] : [week];
  });
}

async function fetchSleeperPlayoffs(
  leagueId: string,
  currentWeek: number,
): Promise<ProviderPlayoffs> {
  const settings = await fetchSleeperLeagueSettings(leagueId);
  const startWeek = settings.settings?.playoff_week_start ?? 0;
  const teamCount = settings.settings?.playoff_teams ?? 0;
  if (startWeek <= 1 || teamCount < 2) {
    return { regularSeasonEndWeek: 18, playoffTeamCount: 0, championship: null };
  }
  const entries = await fetchSleeperJson<SleeperBracketEntry[]>(
    `/league/${leagueId}/winners_bracket`,
  );
  // Title path only - placement games carry a p other than 1.
  const titleEntries = (entries ?? []).filter((entry) => entry.p === undefined || entry.p === 1);
  const roundCount = Math.max(bracketRoundCount(teamCount), ...titleEntries.map((e) => e.r));
  const roundWeeks = sleeperRoundWeeks(
    startWeek,
    roundCount,
    settings.settings?.playoff_round_type ?? 0,
  );

  // Each roster's points per started playoff week, summed over a round's
  // weeks below.
  const playedWeeks = roundWeeks.flat().filter((week) => week <= currentWeek);
  const pointsByWeek = new Map(
    await Promise.all(
      playedWeeks.map(async (week) => {
        const rows = await fetchSleeperJson<SleeperWeekPoints[]>(
          `/league/${leagueId}/matchups/${week}`,
        );
        return [week, new Map(rows.map((row) => [row.roster_id, row.points ?? 0]))] as const;
      }),
    ),
  );
  const roundPoints = (round: number, rosterId: number | null): number | null => {
    if (rosterId === null) return null;
    const weeks = (roundWeeks[round - 1] ?? []).filter((week) => pointsByWeek.has(week));
    if (weeks.length === 0) return null;
    return weeks.reduce((sum, week) => sum + (pointsByWeek.get(week)?.get(rosterId) ?? 0), 0);
  };
  const feeder = (from: SleeperBracketEntry["t1_from"]) =>
    from?.w !== undefined ? String(from.w) : null;
  const games: ProviderBracketGame[] = titleEntries
    .sort((a, b) => a.r - b.r || a.m - b.m)
    .map((entry) => ({
      id: String(entry.m),
      round: entry.r,
      teams: [
        entry.t1 !== null ? String(entry.t1) : null,
        entry.t2 !== null ? String(entry.t2) : null,
      ],
      points: [roundPoints(entry.r, entry.t1), roundPoints(entry.r, entry.t2)],
      winner: entry.w !== null ? String(entry.w) : null,
      from: [feeder(entry.t1_from), feeder(entry.t2_from)],
    }));
  return {
    regularSeasonEndWeek: startWeek - 1,
    playoffTeamCount: teamCount,
    championship: { roundWeeks, games, seeds: {} },
  };
}

async function fetchEspnPlayoffs(espnLeagueId: string, year: string): Promise<ProviderPlayoffs> {
  const schedule = await fetchEspnPlayoffSchedule(espnLeagueId, year);
  const regularSeasonEndWeek = Math.max(
    0,
    ...(schedule.matchupPeriods[String(schedule.regularSeasonPeriodCount)] ?? []),
  );
  if (schedule.playoffTeamCount < 2 || regularSeasonEndWeek === 0) {
    return {
      regularSeasonEndWeek: regularSeasonEndWeek || 18,
      playoffTeamCount: 0,
      championship: null,
    };
  }
  const roundCount = bracketRoundCount(schedule.playoffTeamCount);
  // Playoff matchup periods follow the regular season's, each round its own
  // period (which can span several weeks).
  const roundWeeks = Array.from({ length: roundCount }, (_, i) => {
    const period = schedule.regularSeasonPeriodCount + i + 1;
    return schedule.matchupPeriods[String(period)] ?? [regularSeasonEndWeek + i + 1];
  });
  const games: ProviderBracketGame[] = [];
  const seeded = new Set<string>();
  for (const game of schedule.games) {
    const round = game.matchupPeriodId - schedule.regularSeasonPeriodCount;
    // A round-1 game with one team is that team's bye - it shows up in
    // round 2 on its own.
    if (round === 1 && (game.home === null || game.away === null)) {
      if (game.home) seeded.add(game.home.teamId);
      continue;
    }
    games.push({
      id: `${game.matchupPeriodId}:${games.length}`,
      round,
      teams: [game.home?.teamId ?? null, game.away?.teamId ?? null],
      points: [game.home?.points ?? null, game.away?.points ?? null],
      winner: game.winnerTeamId,
    });
    for (const teamId of [game.home?.teamId, game.away?.teamId]) if (teamId) seeded.add(teamId);
  }
  // Only bracket teams' seeds - ESPN seeds everyone.
  const seeds = Object.fromEntries(
    Object.entries(schedule.seeds).filter(([teamId]) => seeded.has(teamId)),
  );
  return {
    regularSeasonEndWeek,
    playoffTeamCount: schedule.playoffTeamCount,
    championship: { roundWeeks, games, seeds },
    // ESPN's playoffSeed tracks the standings all season - confirmed live
    // mid-season on league 164483.
    currentSeeds: schedule.seeds,
  };
}

async function fetchYahooPlayoffs(
  accessToken: string,
  leagueKey: string,
  currentWeek: number,
): Promise<ProviderPlayoffs> {
  const settings = await fetchYahooLeagueSettings(accessToken, leagueKey);
  const playoffSettings = yahooPlayoffSettings(settings.raw);
  if (!playoffSettings) {
    return {
      regularSeasonEndWeek: yahooRegularSeasonEndWeek(settings.raw) ?? 18,
      playoffTeamCount: 0,
      championship: null,
    };
  }
  const roundCount = bracketRoundCount(playoffSettings.teamCount);
  const roundWeeks = Array.from({ length: roundCount }, (_, i) => [playoffSettings.startWeek + i]);
  // A week's playoff pairings exist once the week before is final.
  const weeksToRead = roundWeeks.flat().filter((week) => week <= currentWeek);
  const gamesByWeek = await Promise.all(
    weeksToRead.map((week) => fetchYahooPlayoffGames(accessToken, leagueKey, week)),
  );
  const games: ProviderBracketGame[] = gamesByWeek.flatMap((weekGames, i) =>
    weekGames
      .filter((game) => game.teams.length === 2)
      .map((game, index) => ({
        id: `${weeksToRead[i]}:${index}`,
        round: i + 1,
        teams: [game.teams[0]!.teamKey, game.teams[1]!.teamKey] as [string, string],
        points: [game.teams[0]!.points, game.teams[1]!.points] as [number | null, number | null],
        winner: game.winnerTeamKey,
      })),
  );
  return {
    regularSeasonEndWeek: playoffSettings.startWeek - 1,
    playoffTeamCount: playoffSettings.teamCount,
    championship: { roundWeeks, games, seeds: {} },
  };
}

// The league's playoff picture - where the regular season ends, and each
// tournament's bracket - read live from the provider and reused for a few
// minutes (an hour on Yahoo). Shared with matchup.ts's playoff weeks.
export async function loadPlayoffs(
  ctx: ActionCtx,
  season: Doc<"seasons">,
  league: Doc<"leagues">,
  teams: Doc<"seasonTeams">[],
  currentWeek: number,
  // Teams in projected final standings order - seeds the bracket instead
  // of today's standings while it isn't set.
  projectedOrder?: Id<"seasonTeams">[] | undefined,
): Promise<LeaguePlayoffs> {
  let playoffs: ProviderPlayoffs;
  let teamIdByProviderId: Map<string, Id<"seasonTeams">>;

  if (season.leagueType === "guillotine") {
    return {
      hasPlayoffs: false,
      regularSeasonEndWeek: 18,
      playoffTeamCount: 0,
      currentWeek,
      phase: "regular",
      seeding: "provider",
      tournaments: [],
    };
  }
  if (season.sleeperLeagueId) {
    const leagueId = season.sleeperLeagueId;
    playoffs = await cachedYahoo(
      ctx,
      `playoffs:sleeper:${leagueId}:${currentWeek}`,
      PLAYOFFS_CACHE_MS,
      () => fetchSleeperPlayoffs(leagueId, currentWeek),
    );
    teamIdByProviderId = new Map(
      teams.flatMap((team) => (team.sleeperRosterId ? [[team.sleeperRosterId, team._id]] : [])),
    );
  } else if (season.yahooLeagueKey) {
    const leagueKey = season.yahooLeagueKey;
    playoffs = await cachedYahoo(
      ctx,
      `playoffs:yahoo:${leagueKey}:${currentWeek}`,
      YAHOO_PLAYOFFS_CACHE_MS,
      () =>
        withYahooToken(ctx, league.ownerId, (accessToken) =>
          fetchYahooPlayoffs(accessToken, leagueKey, currentWeek),
        ),
    );
    teamIdByProviderId = new Map(
      teams.flatMap((team) => (team.yahooTeamKey ? [[team.yahooTeamKey, team._id]] : [])),
    );
  } else if (season.espnLeagueId) {
    const espnLeagueId = season.espnLeagueId;
    playoffs = await cachedYahoo(
      ctx,
      `playoffs:espn:${espnLeagueId}:${season.year}`,
      PLAYOFFS_CACHE_MS,
      () => fetchEspnPlayoffs(espnLeagueId, season.year),
    );
    teamIdByProviderId = new Map(
      teams.flatMap((team) => (team.espnTeamId ? [[team.espnTeamId, team._id]] : [])),
    );
  } else {
    throw new Error("This league isn't linked to Sleeper, Yahoo, or ESPN yet.");
  }

  // Not set yet: seeded here, in seasonTeams ids (so an identity map).
  // Sleeper's all-season projection stands in for today's standings.
  let championshipBracket = playoffs.championship;
  let idMap = teamIdByProviderId;
  let seeding: BracketSeeding = "provider";
  const bracketSet =
    championshipBracket !== null &&
    (currentWeek > playoffs.regularSeasonEndWeek ||
      (championshipBracket.games.length > 0 && !season.sleeperLeagueId));
  if (championshipBracket && !bracketSet) {
    const providerIdByTeamId = new Map([...teamIdByProviderId].map(([key, id]) => [id, key]));
    const providerSeed = (team: Doc<"seasonTeams">) => {
      const key = providerIdByTeamId.get(team._id);
      return key !== undefined ? playoffs.currentSeeds?.[key] : undefined;
    };
    let order: Id<"seasonTeams">[] | null = null;
    if (projectedOrder) {
      order = projectedOrder;
      seeding = "projected";
    } else if (championshipBracket.games.length === 0) {
      const sorted = teams.every((team) => providerSeed(team) !== undefined)
        ? [...teams].sort((a, b) => providerSeed(a)! - providerSeed(b)!)
        : [...teams].sort(compareStandings);
      order = sorted.map((team) => team._id);
      seeding = "current";
    }
    if (order) {
      championshipBracket = seededBracket(
        order.slice(0, playoffs.playoffTeamCount),
        championshipBracket.roundWeeks,
      );
      idMap = new Map(teams.map((team) => [team._id as string, team._id]));
    }
  }
  const tournaments = championshipBracket
    ? [buildTournament("championship", "Championship", championshipBracket, idMap, currentWeek)]
    : [];
  const championship = tournaments[0];
  const phase: SeasonPhase =
    championship?.championTeamId ? "complete"
    : currentWeek > playoffs.regularSeasonEndWeek && championship ? "playoffs"
    : "regular";
  return {
    hasPlayoffs: playoffs.championship !== null,
    regularSeasonEndWeek: playoffs.regularSeasonEndWeek,
    playoffTeamCount: playoffs.playoffTeamCount,
    currentWeek,
    phase,
    seeding,
    tournaments,
  };
}

// The league's playoffs for the Standings tab - see loadPlayoffs.
// projectedOrder is getProjectedStandings' order, which the client already
// has, rather than recomputing it here.
export const getPlayoffs = action({
  args: {
    seasonId: v.id("seasons"),
    projectedOrder: v.optional(v.array(v.id("seasonTeams"))),
  },
  handler: async (ctx: ActionCtx, args): Promise<LeaguePlayoffs> => {
    const { season, league } = await ctx.runQuery(internal.rosterSync.requireOwnedSeasonForSync, {
      seasonId: args.seasonId,
    });
    const [teams, nflState] = await Promise.all([
      ctx.runQuery(internal.seasonTeams.listSeasonTeamsInternal, { seasonId: args.seasonId }),
      ctx.runQuery(api.nflState.getNflState, {}),
    ]);
    return await loadPlayoffs(
      ctx,
      season,
      league,
      teams,
      currentWeekFor(season, nflState),
      args.projectedOrder,
    );
  },
});

// The NFL week to treat as "now" for this season - a past season is over,
// so every week counts as played.
export function currentWeekFor(
  season: Doc<"seasons">,
  nflState: { season: string; week: string } | null,
): number {
  if (!nflState) return 1;
  if (Number(season.year) < Number(nflState.season)) return 99;
  return Math.max(Number(nflState.week), 1);
}

