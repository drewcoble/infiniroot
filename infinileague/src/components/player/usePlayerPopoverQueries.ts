import { useParams } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { api } from "@infinidata/api";
import type { WeekGame } from "../../lib/liveGames";
import { useMatchupGrades } from "../../lib/matchupDifficulty";
import type { FaabSuggestionsResult, RosVorRow, StandingsRow } from "../../types/season";

interface NflState {
  season: string;
  week: string;
}

// Every query the player popover reads - its own and its charts' and game
// log's - with exactly the args they use, so they all share one
// subscription. Called by the popover itself, and by the card it opens
// from while the card is being pressed (`enabled`): the long-press takes
// ~300ms, enough for these to land, so the popover opens fully drawn
// instead of empty and then filling in. A card keeps calling it while its
// popover is open, so nothing unsubscribes in between.
export function usePlayerPopoverQueries(fpid: number | undefined, enabled: boolean) {
  const { leagueId } = useParams({ strict: false });
  const seasonId = leagueId as Id<"seasons"> | undefined;
  const { isAuthenticated } = useConvexAuth();
  const live = enabled && isAuthenticated && seasonId !== undefined && fpid !== undefined;

  const nflState: NflState | null | undefined = useQuery(
    api.nflState.getNflState,
    live ? {} : "skip",
  );
  const week = nflState?.week;
  const standings: StandingsRow[] | undefined = useQuery(
    api.infinileague.season.standings.getStandings,
    live && seasonId ? { seasonId } : "skip",
  );
  // The same board args every league page uses, so it's usually already
  // loaded.
  const board: RosVorRow[] | undefined = useQuery(
    api.rosVor.getRosVorBoard,
    live && seasonId && week ? { seasonId, week } : "skip",
  );
  const weekPoints = useQuery(
    api.rosVor.getWeekPoints,
    live && seasonId && week ? { seasonId, week } : "skip",
  );
  const weekRanks = useQuery(
    api.infinileague.season.matchup.getWeekPositionRanks,
    live && seasonId && week ? { seasonId, week } : "skip",
  );
  const weekGames: WeekGame[] | undefined = useQuery(
    api.sleeper.livePoints.getWeekGames,
    live && nflState && week ? { season: nflState.season, week } : "skip",
  );
  // Same args as the Matchup/team pages', so it's usually already loaded.
  const matchupGrades = useMatchupGrades(live ? seasonId : undefined, week);
  const rookieFpids = useQuery(api.players.getRookieFpids, live ? {} : "skip");
  const byeWeeks: Record<string, number> | undefined = useQuery(
    api.nflSchedule.getByeWeeks,
    live ? {} : "skip",
  );

  const row = fpid !== undefined ? board?.find((entry) => entry.fpid === fpid) : undefined;
  const selfTeam = standings?.find((entry) => entry.isSelf);
  const isFreeAgent = row !== undefined && row.rosteredByTeamName === null;
  const faab: FaabSuggestionsResult | undefined = useQuery(
    api.infinileague.season.faabValues.getFaabSuggestions,
    live && seasonId && isFreeAgent
      ? { seasonId, ...(selfTeam ? { teamId: selfTeam.teamId as Id<"seasonTeams"> } : {}) }
      : "skip",
  );

  // The charts' and game log's own queries (PointsChart, UsageChart,
  // PlayerGameLog) - warmed here, read there.
  const year = nflState?.season;
  const playerSeasonArgs =
    live && seasonId && fpid !== undefined && year ? { seasonId, fpid, year } : "skip";
  useQuery(api.infinileague.season.gameLog.getGameLog, playerSeasonArgs);
  useQuery(api.infinileague.season.usage.getUsageWeeks, playerSeasonArgs);
  useQuery(
    api.infinileague.season.gameLog.getGameLogSeasons,
    live && seasonId && fpid !== undefined ? { seasonId, fpid } : "skip",
  );

  return {
    live,
    seasonId,
    nflState,
    week,
    standings,
    board,
    row,
    selfTeam,
    weekPoints,
    weekRanks,
    weekGames,
    matchupGrades,
    rookieFpids,
    byeWeeks,
    faab,
    // What the popover needs before it's worth drawing at all.
    // (Outside the season - nflState null - there's no board to wait for.)
    ready:
      !live ||
      (nflState !== undefined &&
        standings !== undefined &&
        (nflState === null || board !== undefined)),
  };
}
