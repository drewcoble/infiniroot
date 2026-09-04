import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useAction, useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import {
  Alert,
  Card,
  Loader,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { api } from "@infinidata/api";
import { getErrorMessage } from "@shared/errors";
import { TradeRosterMatchup } from "../../../components/TradeRosterMatchup";
import { TradePowerRankingsList } from "../../../components/TradePowerRankingsList";
import type { PowerRankingRow, RosVorRow, StandingsRow, TeamRosterRow } from "../../../types/season";

export const Route = createFileRoute("/league/$leagueId/trade")({
  component: TradePage,
});

interface NflState {
  season: string;
  week: string;
  seasonType: "pre" | "regular" | "post";
}

interface TradeImpact {
  before: PowerRankingRow[];
  after: PowerRankingRow[];
}

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

// Trade analyzer: pick players off your own team and a second team, and see
// how the swap plays out. Each side's roster renders as paired cards (see
// TradeRosterMatchup.tsx), each card already showing that player's own
// actualVOR/rosVOR; the summary below simulates the league's full power
// rankings (convex/infinileague/season/powerRankings.ts's rest-of-season
// optimal-lineup total, same computation the league dashboard's Power
// Rankings tab shows) with the selected players swapped between the two
// rosters, so the payoff reads as "where would this actually land us" -
// not just a raw value delta, but the real decision-relevant number: does
// this trade move us up the standings-that-matter.
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

  // No auto-pick here (unlike teamAId above) - column 2 starts on the
  // selector's own placeholder until the user actually chooses who they're
  // trading with, rather than silently defaulting to some other team.
  const [teamBId, setTeamBId] = useState<string | null>(null);

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

  const getPowerRankingsWithTrade = useAction(
    api.infinileague.season.powerRankings.getPowerRankingsWithTrade,
  );
  const [tradeImpact, setTradeImpact] = useState<TradeImpact | undefined>(undefined);
  const [tradeImpactError, setTradeImpactError] = useState<string | null>(null);

  useEffect(() => {
    if (teamAId === null || teamBId === null || selectedA.size === 0 || selectedB.size === 0) {
      setTradeImpact(undefined);
      setTradeImpactError(null);
      return;
    }
    // Debounced rather than firing on every single checkbox click - this
    // call re-fetches live Sleeper rosters and every remaining week's
    // projections server-side (see getPowerRankingsWithTrade), genuinely
    // too expensive to run on each toggle while someone's still building
    // out a package.
    const outgoingFromA = [...selectedA];
    const outgoingFromB = [...selectedB];
    const timeout = setTimeout(() => {
      getPowerRankingsWithTrade({
        seasonId,
        teamAId: teamAId as Id<"seasonTeams">,
        teamBId: teamBId as Id<"seasonTeams">,
        outgoingFromA,
        outgoingFromB,
      })
        .then(setTradeImpact)
        .catch((err) =>
          setTradeImpactError(getErrorMessage(err, "Failed to compute trade impact.")),
        );
    }, 400);
    return () => clearTimeout(timeout);
  }, [seasonId, teamAId, teamBId, selectedA, selectedB, getPowerRankingsWithTrade]);

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

  const teamBOptions = standings
    .filter((row) => row.teamId !== teamAId)
    .map((row) => ({ value: row.teamId, label: row.name }));

  const beforeRankByTeam = new Map(
    (tradeImpact?.before ?? []).map((row, index) => [row.teamId, index + 1]),
  );

  return (
    <Stack gap="md">
      <Title order={3}>Trade Analyzer</Title>

      {teamARoster.error && <Alert color="red">{teamARoster.error}</Alert>}
      {teamBRoster.error && <Alert color="red">{teamBRoster.error}</Alert>}

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <Title order={5}>{selfTeamName ?? "Your team"}</Title>
        <Select
          label="Trading with"
          placeholder="Select a team"
          data={teamBOptions}
          value={teamBId}
          onChange={setTeamBId}
          clearable
          w={{ base: "100%", sm: 220 }}
        />
      </SimpleGrid>

      <Stack gap={8}>
        <TradeRosterMatchup
          teamARows={teamARoster.rows}
          teamBRows={teamBRoster.rows}
          vorByFpid={vorByFpid}
          selectedA={selectedA}
          selectedB={selectedB}
          onToggleA={toggleA}
          onToggleB={toggleB}
        />
      </Stack>

      {teamBId !== null && (
        <Card withBorder padding="md">
          <Title order={5} mb="xs">
            Power rankings if this trade happened
          </Title>
          {selectedA.size === 0 || selectedB.size === 0 ? (
            <Text c="dimmed" size="sm">
              Select players from both teams to preview this trade&apos;s power-ranking impact.
            </Text>
          ) : tradeImpactError ? (
            <Alert color="red" withCloseButton onClose={() => setTradeImpactError(null)}>
              {tradeImpactError}
            </Alert>
          ) : tradeImpact === undefined ? (
            <Loader size="sm" />
          ) : (
            <TradePowerRankingsList
              leagueId={leagueId}
              rows={tradeImpact.after}
              beforeRankByTeam={beforeRankByTeam}
              highlightedTeamIds={new Set([teamAId, teamBId])}
            />
          )}
        </Card>
      )}
    </Stack>
  );
}
