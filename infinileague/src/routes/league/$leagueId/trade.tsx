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
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { api } from "@infinidata/api";
import { getErrorMessage } from "@shared/errors";
import { TradeRosterPanel } from "../../../components/TradeRosterPanel";
import { extractSlotCounts } from "../../../lib/lineupSuggestions";
import { buildTradePool, simulateTrade, type TradeSideResult } from "../../../lib/tradeAnalyzer";
import type { RosVorRow, SlotLabel, StandingsRow, TeamRosterRow } from "../../../types/season";

export const Route = createFileRoute("/league/$leagueId/trade")({
  component: TradePage,
});

interface NflState {
  season: string;
  week: string;
  seasonType: "pre" | "regular" | "post";
}

// rosVOR is the trade math's currency throughout - rest-of-season,
// momentum-adjusted, the forward-looking number a trade decision actually
// needs (vs. actualVOR's season-to-date backward view). No toggle for
// actualVOR yet - can be added to tradeAnalyzer's call sites later without
// touching its API, which already takes the metric as a parameter.
const METRIC = "rosVor" as const;

// Thin wrapper around the teamRoster action (same one teams/$teamId.tsx
// calls) - re-fetches whenever teamId/week change, null-safe so callers can
// pass a not-yet-known teamId without an extra guard at every call site.
function useTeamRoster(teamId: string | null, week: string | null) {
  const getTeamRosterForWeek = useAction(
    api.infinileague.season.teamRoster.getTeamRosterForWeek,
  );
  const [rows, setRows] = useState<TeamRosterRow[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (teamId === null || week === null) return;
    setRows(undefined);
    setError(null);
    getTeamRosterForWeek({ teamId: teamId as Id<"seasonTeams">, week })
      .then(setRows)
      .catch((err) => setError(getErrorMessage(err, "Failed to load roster.")));
  }, [teamId, week, getTeamRosterForWeek]);

  return { rows, error };
}

function verdict(lineupImpact: number): { label: string; color: string } {
  if (lineupImpact > 0.05) return { label: "Gains", color: "green" };
  if (lineupImpact < -0.05) return { label: "Weaker", color: "red" };
  return { label: "Even", color: "gray" };
}

interface TradeSideSummaryProps {
  teamName: string;
  side: TradeSideResult;
  hasLineupData: boolean;
}

function TradeSideSummary({ teamName, side, hasLineupData }: TradeSideSummaryProps) {
  const { label, color } = verdict(side.lineupImpact);
  const rawDelta = side.rawReceived - side.rawSent;
  return (
    <Stack gap={6}>
      <Group justify="space-between">
        <Text fw={600}>{teamName}</Text>
        {hasLineupData && (
          <Badge color={color} variant="light">
            {label}
          </Badge>
        )}
      </Group>
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          Raw rosVOR
        </Text>
        <Text size="sm">
          +{side.rawReceived.toFixed(1)} / -{side.rawSent.toFixed(1)} ({rawDelta >= 0 ? "+" : ""}
          {rawDelta.toFixed(1)})
        </Text>
      </Group>
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          Starting lineup impact
        </Text>
        <Text size="sm" fw={700}>
          {hasLineupData
            ? `${side.lineupImpact >= 0 ? "+" : ""}${side.lineupImpact.toFixed(1)}`
            : "—"}
        </Text>
      </Group>
      {!hasLineupData && (
        <Text size="xs" c="dimmed">
          No starting-lineup data for this team (not Sleeper-linked).
        </Text>
      )}
    </Stack>
  );
}

// Trade analyzer: pick players off your own team and a second team, and see
// how the swap affects each side. "Raw rosVOR" is a plain sum of value sent
// vs. received; "Starting lineup impact" simulates each team's best-possible
// starting lineup before vs. after the trade (via the same tiered-greedy
// fill src/lib/lineupSuggestions.ts's buildLineupSuggestions uses for "My
// Team" start/sit advice, generalized in src/lib/tradeAnalyzer.ts) - it's
// the more decision-relevant number, since two bench-bound players moving
// the raw sum doesn't mean they actually crack the lineup.
function TradePage() {
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

  const vorRows: RosVorRow[] | undefined = useQuery(
    api.rosVor.getRosVorBoard,
    isAuthenticated && nflState ? { seasonId, week: nflState.week } : "skip",
  );
  const vorByFpid = new Map((vorRows ?? []).map((row) => [row.fpid, row]));

  const [teamAId, setTeamAId] = useState<string | null>(null);
  useEffect(() => {
    if (teamAId !== null || !standings) return;
    const self = standings.find((row) => row.isSelf);
    if (self) setTeamAId(self.teamId);
  }, [standings, teamAId]);

  const [teamBId, setTeamBId] = useState<string | null>(null);
  useEffect(() => {
    if (teamBId !== null || !standings || teamAId === null) return;
    const other = standings.find((row) => row.teamId !== teamAId);
    if (other) setTeamBId(other.teamId);
  }, [standings, teamAId, teamBId]);

  const week = nflState?.week ?? null;
  const teamARoster = useTeamRoster(teamAId, week);
  const teamBRoster = useTeamRoster(teamBId, week);

  const [selectedA, setSelectedA] = useState<Set<number>>(new Set());
  const [selectedB, setSelectedB] = useState<Set<number>>(new Set());
  useEffect(() => {
    setSelectedB(new Set());
  }, [teamBId]);

  const toggleA = (fpid: number) =>
    setSelectedA((prev) => {
      const next = new Set(prev);
      if (next.has(fpid)) {
        next.delete(fpid);
      } else {
        next.add(fpid);
      }
      return next;
    });
  const toggleB = (fpid: number) =>
    setSelectedB((prev) => {
      const next = new Set(prev);
      if (next.has(fpid)) {
        next.delete(fpid);
      } else {
        next.add(fpid);
      }
      return next;
    });

  if (nflState === undefined || standings === undefined || vorRows === undefined) {
    return <Loader />;
  }

  if (nflState === null || nflState.seasonType !== "regular") {
    return (
      <Stack align="center" py="xl" gap={4}>
        <Text c="dimmed">Not currently in an NFL regular season week.</Text>
        <Text c="dimmed" size="sm">
          The trade analyzer will be available once the season starts.
        </Text>
      </Stack>
    );
  }

  if (vorRows.length === 0) {
    return (
      <Stack align="center" py="xl" gap={4}>
        <Text c="dimmed">Player rankings haven&apos;t been computed for this week yet.</Text>
        <Text c="dimmed" size="sm">
          Check back after the next daily refresh.
        </Text>
      </Stack>
    );
  }

  const selfTeamName = standings.find((row) => row.teamId === teamAId)?.name;

  if (teamAId === null || teamARoster.rows === undefined) {
    return <Loader />;
  }

  const teamAPool = buildTradePool(teamARoster.rows, vorByFpid, METRIC);
  const teamASlotCounts = extractSlotCounts(teamARoster.rows);

  const teamBOptions = standings
    .filter((row) => row.teamId !== teamAId)
    .map((row) => ({ value: row.teamId, label: row.name }));
  const teamBName = standings.find((row) => row.teamId === teamBId)?.name ?? "Team";

  const teamBRows = teamBRoster.rows;
  const teamBReady = teamBId !== null && teamBRows !== undefined;
  const teamBPool = teamBRows ? buildTradePool(teamBRows, vorByFpid, METRIC) : [];
  const teamBSlotCounts = teamBRows ? extractSlotCounts(teamBRows) : new Map<SlotLabel, number>();

  const outgoingFromA = teamAPool.filter((entry) => selectedA.has(entry.fpid));
  const outgoingFromB = teamBPool.filter((entry) => selectedB.has(entry.fpid));

  const result = teamBReady
    ? simulateTrade({
        teamAPool,
        teamASlotCounts,
        teamBPool,
        teamBSlotCounts,
        outgoingFromA,
        outgoingFromB,
      })
    : null;

  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="wrap" align="center">
        <Title order={3}>Trade Analyzer</Title>
        <Select
          label="Trading with"
          data={teamBOptions}
          value={teamBId}
          onChange={setTeamBId}
          allowDeselect={false}
          w={220}
        />
      </Group>

      {teamARoster.error && <Alert color="red">{teamARoster.error}</Alert>}
      {teamBRoster.error && <Alert color="red">{teamBRoster.error}</Alert>}

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <Card withBorder padding="md">
          <Title order={5} mb="xs">
            {selfTeamName ?? "Your team"}
          </Title>
          <TradeRosterPanel
            rows={teamARoster.rows}
            vorByFpid={vorByFpid}
            metric={METRIC}
            selected={selectedA}
            onToggle={toggleA}
          />
        </Card>
        <Card withBorder padding="md">
          <Title order={5} mb="xs">
            {teamBName}
          </Title>
          {teamBRoster.rows === undefined ? (
            <Loader />
          ) : (
            <TradeRosterPanel
              rows={teamBRoster.rows}
              vorByFpid={vorByFpid}
              metric={METRIC}
              selected={selectedB}
              onToggle={toggleB}
            />
          )}
        </Card>
      </SimpleGrid>

      <Card withBorder padding="md">
        {result === null ? (
          <Loader />
        ) : (
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
            <TradeSideSummary
              teamName={selfTeamName ?? "Your team"}
              side={result.teamA}
              hasLineupData={teamASlotCounts.size > 0}
            />
            <TradeSideSummary
              teamName={teamBName}
              side={result.teamB}
              hasLineupData={teamBSlotCounts.size > 0}
            />
          </SimpleGrid>
        )}
      </Card>
    </Stack>
  );
}
