import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import {
  Alert,
  Card,
  Group,
  Loader,
  Select,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { api } from "@infinidata/api";
import { TeamRosterList, TeamRosterListSkeleton } from "../../../../components/TeamRosterList";
import { meterScaleMax } from "../../../../components/cards/meterScale";
import { useTeamRoster } from "../../../../hooks/useTeamRoster";
import { isAnyGameLive, useNow, type WeekGame } from "../../../../lib/liveGames";
import { toMatchupCardData } from "../../../../lib/matchupCardData";
import { LineupSuggestionsCard } from "../../../../components/LineupSuggestionsCard";
import type { RosVorRow, SlotLabel, StandingsRow, TeamRosterRow } from "../../../../types/season";

export const Route = createFileRoute("/league/$leagueId/teams/$teamId")({
  component: TeamPage,
});

interface NflState {
  season: string;
  week: string;
  seasonType: "pre" | "regular" | "post";
}

const WEEK_OPTIONS = Array.from({ length: 18 }, (_, i) => String(i + 1));

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
  field: "projectedPoints" | "actualPoints",
): number {
  return rows.reduce((total, row) => {
    if (!row.slot || !STARTER_SLOTS.has(row.slot)) return total;
    return total + (row[field] ?? 0);
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

  // Defaults to the current NFL week once known - purely a starting value
  // for the dropdown, not used for any data-source branching (see
  // convex/season/teamRoster.ts's own comment on why there's only one data
  // path for every week). "0" (pre-season) clamps to "1" since that's not
  // a real week to request a matchup for.
  const [week, setWeek] = useState<string | null>(null);
  useEffect(() => {
    if (week !== null || nflState === undefined) return;
    const currentWeek = nflState ? Number(nflState.week) : 0;
    setWeek(currentWeek > 0 ? String(currentWeek) : "1");
  }, [nflState, week]);

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
  const vorByFpid = useMemo(() => new Map((vorRows ?? []).map((row) => [row.fpid, row])), [vorRows]);
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

  if (team === undefined) {
    return <Loader />;
  }

  return (
    <Stack gap="md">
      <Card padding="lg">
        <Group justify="space-between" wrap="wrap" gap="sm">
          <Stack gap={4}>
            <Title order={3}>{team.name}</Title>
            <Text c="dimmed" size="sm">
              Rank #{team.rank} · {team.wins}-{team.losses}-{team.ties} ·{" "}
              {team.pointsFor.toFixed(1)} PF / {team.pointsAgainst.toFixed(1)} PA
            </Text>
          </Stack>
          <Text fw={600}>
            {team.faabRemaining !== undefined
              ? `$${team.faabRemaining} FAAB`
              : `Waiver #${team.waiverPosition ?? "—"}`}
          </Text>
        </Group>
      </Card>

      {roster !== undefined && <LineupSuggestionsCard rows={roster} />}

      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap" gap="sm" align="flex-end">
          <Select
            label="Week"
            data={WEEK_OPTIONS}
            value={week}
            onChange={(value) => value && setWeek(value)}
            allowDeselect={false}
            w={120}
          />

          {roster !== undefined && (
            <Card padding="xs">
              <Group gap="lg">
                <Stack gap={0} align="center">
                  <Text size="xs" c="dimmed" tt="uppercase">
                    Projected
                  </Text>
                  <Text fw={600}>
                    {sumStarterPoints(roster, "projectedPoints").toFixed(1)}
                  </Text>
                </Stack>
                <Stack gap={0} align="center">
                  <Text size="xs" c="dimmed" tt="uppercase">
                    Actual
                  </Text>
                  <Text fw={600}>
                    {sumStarterPoints(roster, "actualPoints").toFixed(1)}
                  </Text>
                </Stack>
              </Group>
            </Card>
          )}
        </Group>

        {teamRoster.error && <Alert color="red">{teamRoster.error}</Alert>}

        {roster === undefined ? (
          teamRoster.error ? null : <TeamRosterListSkeleton />
        ) : (
          <TeamRosterList
            rows={roster}
            toCardData={toCardData}
            scaleMax={meterScaleMax(
              roster.filter((row) => row.fpid !== undefined).map(toCardData),
            )}
          />
        )}
      </Stack>
    </Stack>
  );
}
