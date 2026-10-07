import { useMemo } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { Alert, Group, Stack, Title } from "@mantine/core";
import { ChevronLeft } from "lucide-react";
import { api } from "@infinidata/api";
import { TeamRosterList, TeamRosterListSkeleton } from "../../../../components/TeamRosterList";
import { WeekPicker } from "../../../../components/WeekPicker";
import classes from "../../../../components/cards/GlassMatchupCard.module.css";
import {
  GlassTeamHeader,
  type TeamWeekSummary,
} from "../../../../components/cards/GlassTeamHeader";
import { meterScaleMax } from "../../../../components/cards/meterScale";
import { useTeamRoster } from "../../../../hooks/useTeamRoster";
import {
  isAnyGameLive,
  liveProjection,
  remainingFraction,
  useNow,
  type WeekGame,
} from "../../../../lib/liveGames";
import { toMatchupCardData } from "../../../../lib/matchupCardData";
import { LineupSuggestionsCard } from "../../../../components/LineupSuggestionsCard";
import type { RosVorRow, SlotLabel, StandingsRow, TeamRosterRow } from "../../../../types/season";

const REGULAR_SEASON_WEEKS = 18;

// ?week=N views another week (same convention as the Matchup tab); absent =
// the current NFL week. Out-of-range values are dropped rather than erroring.
export const Route = createFileRoute("/league/$leagueId/teams/$teamId")({
  validateSearch: (search: Record<string, unknown>): { week?: number } => {
    const week = Number(search.week);
    return Number.isInteger(week) && week >= 1 && week <= REGULAR_SEASON_WEEKS ? { week } : {};
  },
  component: TeamPage,
});

interface NflState {
  season: string;
  week: string;
  seasonType: "pre" | "regular" | "post";
}

// While a game is on, how often the roster's points are re-fetched - same
// cadence as the Matchup tab (the live poll's own, see convex/crons.ts).
const LIVE_REFRESH_MS = 2 * 60 * 1000;

// Starting lineup slots only - excludes BENCH/IR/TAXI, whose points don't
// count toward the team's total for the week (mirrors Sleeper's own
// matchup total, which is starters-only).
const STARTER_SLOTS = new Set<SlotLabel>([
  "QB",
  "SUPERFLEX",
  "RB",
  "WR",
  "FLEX",
  "TE",
  "DST",
  "K",
]);

function sumStarterPoints(
  rows: TeamRosterRow[],
  pointsFor: (row: TeamRosterRow) => number,
): number {
  return rows.reduce((total, row) => {
    if (!row.slot || !STARTER_SLOTS.has(row.slot)) return total;
    return total + pointsFor(row);
  }, 0);
}

function TeamPage() {
  const { leagueId, teamId } = Route.useParams();
  // Same route-param-is-always-a-string caveat as the league index page -
  // convexApi.ts's FunctionReference types expect the branded Id<>
  // convex/values declares.
  const seasonId = leagueId as Id<"seasons">;
  const { isAuthenticated } = useConvexAuth();

  // Reuses the same standings query the league page's table already calls -
  // no dedicated "one team's info" query exists or is needed (see this
  // feature's plan doc).
  const standings: StandingsRow[] | undefined = useQuery(
    api.infinileague.season.standings.getStandings,
    isAuthenticated ? { seasonId } : "skip",
  );
  const team = standings?.find((row) => row.teamId === teamId);

  const nflState: NflState | null | undefined = useQuery(
    api.nflState.getNflState,
    isAuthenticated ? {} : "skip",
  );

  // The week being viewed - ?week= when set, otherwise the current NFL
  // week ("0" outside the season clamps to week 1).
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const currentWeek =
    nflState === undefined ? null : nflState && Number(nflState.week) > 0 ? nflState.week : "1";
  const week = search.week !== undefined ? String(search.week) : currentWeek;
  const goToWeek = (next: number) =>
    void navigate({ search: String(next) === currentWeek ? {} : { week: next } });

  // The week's slate (opponent/kickoff/live status per NFL team) - drives
  // each card's game line, status icon, and live projection.
  const weekGames: WeekGame[] | undefined = useQuery(
    api.sleeper.livePoints.getWeekGames,
    isAuthenticated && nflState && week ? { season: nflState.season, week } : "skip",
  );
  const gamesByTeam = useMemo(
    () => new Map((weekGames ?? []).map((game) => [game.team, game])),
    [weekGames],
  );
  const now = useNow(60 * 1000);
  const isCurrentWeek = nflState != null && week === nflState.week;
  const refreshMs = isCurrentWeek && isAnyGameLive(weekGames, now) ? LIVE_REFRESH_MS : null;

  // Keyed by team/week (see useTeamRoster), so a week change shows the
  // loading skeleton rather than the previous week's roster.
  const teamRoster = useTeamRoster(teamId, week, refreshMs);
  const roster = teamRoster.rows;

  // Season/ROS context for the detail cards (current week's board, as on
  // the Matchup tab) and this week's actual position ranks for the badges.
  const vorRows: RosVorRow[] | undefined = useQuery(
    api.rosVor.getRosVorBoard,
    isAuthenticated && nflState ? { seasonId, week: nflState.week } : "skip",
  );
  const vorByFpid = useMemo(
    () => new Map((vorRows ?? []).map((row) => [row.fpid, row])),
    [vorRows],
  );
  const weekRanks = useQuery(
    api.infinileague.season.matchup.getWeekPositionRanks,
    isAuthenticated && week ? { seasonId, week } : "skip",
  );
  const weekRankByFpid = useMemo(
    () => new Map((weekRanks ?? []).map((entry) => [entry.fpid, entry.rank])),
    [weekRanks],
  );

  const toCardData = (row: TeamRosterRow) =>
    toMatchupCardData(
      row,
      weekGames ? gamesByTeam : undefined,
      now,
      row.fpid !== undefined ? vorByFpid.get(row.fpid) : undefined,
      row.fpid !== undefined ? weekRankByFpid.get(row.fpid) : undefined,
    );

  // The week's starters in header form: score, projection, and how many
  // are live / still to play. Same projection rule as the Matchup header -
  // live while games remain, the original pregame projection once every
  // starter's game is final (the live one just equals the score by then).
  const summary = ((): TeamWeekSummary | undefined => {
    if (!roster) return undefined;
    const states = roster
      .filter((row) => row.fpid !== undefined && row.slot && STARTER_SLOTS.has(row.slot))
      .map((row) => toCardData(row).gameState);
    const liveCount = states.filter((state) => state === "live").length;
    const toPlayCount = states.filter((state) => state === "pre").length;
    const allFinal = liveCount === 0 && toPlayCount === 0;
    return {
      actualPoints: sumStarterPoints(roster, (row) => row.actualPoints ?? 0),
      projectedPoints: allFinal
        ? sumStarterPoints(roster, (row) => row.projectedPoints ?? 0)
        : sumStarterPoints(roster, (row) =>
            liveProjection(
              row.projectedPoints,
              row.actualPoints,
              remainingFraction(row.team ? gamesByTeam.get(row.team) : undefined, now),
            ),
          ),
      liveCount,
      toPlayCount,
    };
  })();

  return (
    <Stack gap="md">
      {/* Same title row as the Matchup tab. This route also shows other
          teams (opened from the league home's list) - those get a back
          chevron to the league page; your own is the Team tab itself. */}
      <Group justify="space-between" align="center" wrap="nowrap">
        <Group gap={10} wrap="nowrap">
          {team !== undefined && !team.isSelf && (
            // Round glass button, same as the league home's sync button.
            <Link
              to="/league/$leagueId"
              params={{ leagueId }}
              className={classes.glassIconButton}
              aria-label="Back to league"
            >
              <ChevronLeft size={18} strokeWidth={2.5} />
            </Link>
          )}
          <Title order={3}>Team</Title>
        </Group>
        {week !== null && (
          <WeekPicker
            week={Number(week)}
            currentWeek={currentWeek !== null ? Number(currentWeek) : null}
            lastWeek={REGULAR_SEASON_WEEKS}
            onChange={goToWeek}
          />
        )}
      </Group>

      <GlassTeamHeader team={team} summary={summary} />

      {/* Start/sit advice is only actionable for your own lineup, and only
          for a week that hasn't already happened. */}
      {roster !== undefined &&
        team?.isSelf &&
        week !== null &&
        currentWeek !== null &&
        Number(week) >= Number(currentWeek) && <LineupSuggestionsCard rows={roster} />}

      <Stack gap="sm">
        {teamRoster.error && <Alert color="red">{teamRoster.error}</Alert>}

        {roster === undefined ? (
          teamRoster.error ? null : (
            <TeamRosterListSkeleton />
          )
        ) : (
          <TeamRosterList
            rows={roster}
            toCardData={toCardData}
            scaleMax={meterScaleMax(roster.filter((row) => row.fpid !== undefined).map(toCardData))}
          />
        )}
      </Stack>
    </Stack>
  );
}
