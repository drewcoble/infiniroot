import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useAction, useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import {
  Alert,
  Badge,
  Card,
  Group,
  Loader,
  Select,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { api } from "@infinidata/api";
import { AppHeader } from "../../../../components/AppHeader";
import { PageContainer } from "@shared/PageContainer";
import { TeamRosterTable } from "../../../../components/TeamRosterTable";
import { LineupSuggestionsCard } from "../../../../components/LineupSuggestionsCard";
import { getErrorMessage } from "@shared/errors";
import type { SlotLabel, StandingsRow, TeamRosterRow } from "../../../../types/season";

export const Route = createFileRoute("/league/$leagueId/teams/$teamId")({
  component: TeamPage,
});

interface NflState {
  season: string;
  week: string;
  seasonType: "pre" | "regular" | "post";
}

const WEEK_OPTIONS = Array.from({ length: 18 }, (_, i) => String(i + 1));

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
  const teamIdTyped = teamId as Id<"seasonTeams">;
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

  const getTeamRosterForWeek = useAction(api.infinileague.season.teamRoster.getTeamRosterForWeek);
  const [roster, setRoster] = useState<TeamRosterRow[] | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (week === null) return;
    setLoading(true);
    setLoadError(null);
    getTeamRosterForWeek({ teamId: teamIdTyped, week })
      .then(setRoster)
      .catch((err) => setLoadError(getErrorMessage(err, "Failed to load roster.")))
      .finally(() => setLoading(false));
  }, [week, teamIdTyped, getTeamRosterForWeek]);

  return (
    <PageContainer>
      <Stack gap="lg">
        <AppHeader />
        {team === undefined ? (
          <Loader />
        ) : (
          <Stack gap="md">
            <Card withBorder padding="lg">
              <Group justify="space-between" wrap="wrap" gap="sm">
                <Stack gap={4}>
                  <Group gap={8}>
                    <Title order={3}>{team.name}</Title>
                    {team.isSelf && (
                      <Badge size="sm" variant="light">
                        You
                      </Badge>
                    )}
                  </Group>
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
                  <Card withBorder padding="xs">
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

              {loadError && (
                <Alert color="red" withCloseButton onClose={() => setLoadError(null)}>
                  {loadError}
                </Alert>
              )}

              {loading || roster === undefined ? (
                <Loader />
              ) : (
                <TeamRosterTable rows={roster} />
              )}
            </Stack>
          </Stack>
        )}
      </Stack>
    </PageContainer>
  );
}
