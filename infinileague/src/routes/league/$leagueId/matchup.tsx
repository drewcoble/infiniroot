import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useAction, useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { Alert, Card, Group, Loader, Select, Stack, Text, Title } from "@mantine/core";
import { api } from "@infinidata/api";
import { getErrorMessage } from "@shared/errors";
import { useTeamRoster } from "../../../hooks/useTeamRoster";
import { MatchupRosterMatchup } from "../../../components/MatchupRosterMatchup";
import type { SlotLabel, StandingsRow, TeamRosterRow } from "../../../types/season";

export const Route = createFileRoute("/league/$leagueId/matchup")({
  component: MatchupPage,
});

interface NflState {
  season: string;
  week: string;
  seasonType: "pre" | "regular" | "post";
}

// Starting lineup slots only - excludes BENCH/IR/TAXI, whose points don't
// count toward the team's total for the week. Same list teams/$teamId.tsx's
// own sumStarterPoints uses for the "My Team" header card.
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
  rows: TeamRosterRow[] | undefined,
  field: "projectedPoints" | "actualPoints",
): number {
  if (!rows) return 0;
  return rows.reduce((total, row) => {
    if (!row.slot || !STARTER_SLOTS.has(row.slot)) return total;
    return total + (row[field] ?? 0);
  }, 0);
}

// Head-to-head view of this week's matchup: your own roster on the left,
// this week's opponent on the right, lined up slot-by-slot (see
// MatchupRosterMatchup.tsx) same layout as the Trade tab, minus the
// selection/power-rankings machinery that's specific to building a trade.
// Opponent is auto-detected via Sleeper's matchup_id (see convex/
// infinileague/season/matchup.ts's getOpponentForWeek) when the season's
// Sleeper-linked; Yahoo has no matchup sync yet (see YAHOO.md) and a bye
// week has no real opponent either, so both fall back to a manual team
// picker rather than blocking the page.
function MatchupPage() {
  const { leagueId } = Route.useParams();
  const seasonId = leagueId as Id<"seasons">;
  const { isAuthenticated } = useConvexAuth();

  const nflState: NflState | null | undefined = useQuery(
    api.nflState.getNflState,
    isAuthenticated ? {} : "skip",
  );

  const standings: StandingsRow[] | undefined = useQuery(
    api.infinileague.season.standings.getStandings,
    isAuthenticated ? { seasonId } : "skip",
  );

  const [teamAId, setTeamAId] = useState<string | null>(null);
  useEffect(() => {
    if (teamAId !== null || !standings) return;
    const self = standings.find((row) => row.isSelf);
    if (self) setTeamAId(self.teamId);
  }, [standings, teamAId]);

  const week = nflState?.week ?? null;

  const getOpponentForWeek = useAction(api.infinileague.season.matchup.getOpponentForWeek);
  // undefined = not resolved yet, null = resolved but no auto-detected
  // opponent (not Sleeper-linked, or a bye week), a teamId = found.
  const [autoOpponentId, setAutoOpponentId] = useState<string | null | undefined>(undefined);
  const [opponentError, setOpponentError] = useState<string | null>(null);
  useEffect(() => {
    if (teamAId === null || week === null) return;
    setAutoOpponentId(undefined);
    getOpponentForWeek({ teamId: teamAId as Id<"seasonTeams">, week })
      .then((result) => setAutoOpponentId(result.opponentTeamId))
      .catch((err) => {
        setOpponentError(getErrorMessage(err, "Failed to look up this week's opponent."));
        setAutoOpponentId(null);
      });
  }, [teamAId, week, getOpponentForWeek]);

  // Only ever read from once autoOpponentId resolves to null (see above) -
  // the manual Select stays hidden while auto-detection is still pending so
  // it doesn't flash on screen for the common Sleeper-linked case.
  const [manualOpponentId, setManualOpponentId] = useState<string | null>(null);
  const teamBId = autoOpponentId ?? manualOpponentId;

  const teamARoster = useTeamRoster(teamAId, week);
  const teamBRoster = useTeamRoster(teamBId, week);

  if (nflState === undefined || standings === undefined) {
    return <Loader />;
  }

  if (nflState === null || nflState.seasonType !== "regular") {
    return (
      <Stack align="center" py="xl" gap={4}>
        <Text c="dimmed">Not currently in an NFL regular season week.</Text>
        <Text c="dimmed" size="sm">
          Matchups will be available once the season starts.
        </Text>
      </Stack>
    );
  }

  if (teamAId === null || teamARoster.rows === undefined) {
    return <Loader />;
  }

  const selfTeamName = standings.find((row) => row.teamId === teamAId)?.name ?? "Your team";
  const opponentName = standings.find((row) => row.teamId === teamBId)?.name ?? "Opponent";

  const teamBOptions = standings
    .filter((row) => row.teamId !== teamAId)
    .map((row) => ({ value: row.teamId, label: row.name }));

  const projA = sumStarterPoints(teamARoster.rows, "projectedPoints");
  const actualA = sumStarterPoints(teamARoster.rows, "actualPoints");
  const projB = sumStarterPoints(teamBRoster.rows, "projectedPoints");
  const actualB = sumStarterPoints(teamBRoster.rows, "actualPoints");

  return (
    <Stack gap="md">
      <Title order={3}>Matchup</Title>

      {opponentError && (
        <Alert color="red" withCloseButton onClose={() => setOpponentError(null)}>
          {opponentError}
        </Alert>
      )}
      {teamARoster.error && <Alert color="red">{teamARoster.error}</Alert>}
      {teamBRoster.error && <Alert color="red">{teamBRoster.error}</Alert>}

      {autoOpponentId === null && (
        <Select
          label="Opponent this week"
          placeholder="Select a team"
          data={teamBOptions}
          value={manualOpponentId}
          onChange={setManualOpponentId}
          clearable
          w={{ base: "100%", sm: 220 }}
        />
      )}

      <Card withBorder padding="lg">
        <Group justify="space-between" wrap="wrap" gap="sm">
          <Stack gap={4}>
            <Text fw={600}>{selfTeamName}</Text>
            <Text fw={700} size="xl">
              {actualA.toFixed(1)}
            </Text>
            <Text size="xs" c="dimmed">
              Proj {projA.toFixed(1)}
            </Text>
          </Stack>
          <Text c="dimmed" fw={600}>
            VS
          </Text>
          <Stack gap={4} align="flex-end">
            <Text fw={600}>{teamBId !== null ? opponentName : "—"}</Text>
            <Text fw={700} size="xl">
              {teamBId !== null ? actualB.toFixed(1) : "—"}
            </Text>
            <Text size="xs" c="dimmed">
              {teamBId !== null ? `Proj ${projB.toFixed(1)}` : ""}
            </Text>
          </Stack>
        </Group>
      </Card>

      <Stack gap={8}>
        <MatchupRosterMatchup
          teamARows={teamARoster.rows}
          teamBRows={teamBRoster.rows}
          teamAName={selfTeamName}
          teamBName={opponentName}
        />
      </Stack>
    </Stack>
  );
}
