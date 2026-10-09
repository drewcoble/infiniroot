import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useAction, useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { Alert, Box, Select, Stack, Text, Title } from "@mantine/core";
import { api } from "@infinidata/api";
import { getErrorMessage } from "@shared/errors";
import { useTeamRoster } from "../../../hooks/useTeamRoster";
import { TradeRosterMatchup } from "../../../components/TradeRosterMatchup";
import { MatchupRosterSkeleton } from "../../../components/MatchupRosterMatchup";
import { GlassTradeHeader, type TradeHeaderTeam } from "../../../components/cards/GlassTradeHeader";
import { buildShortNames } from "../../../lib/shortPlayerName";
import { GlassSegmented } from "../../../components/cards/GlassSegmented";
import type { TradeMetric } from "../../../components/cards/GlassTradeCard";
import { TradePowerRankingsList } from "../../../components/TradePowerRankingsList";
import {
  TradePowerRankingsSheet,
  TRADE_PEEK_CARD_HEIGHT,
} from "../../../components/TradePowerRankingsSheet";
import type {
  PowerRankingRow,
  RosVorRow,
  StandingsRow,
  TeamRosterRow,
} from "../../../types/season";

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

// Which trade a result or error was computed for - partner plus both
// sides' selections, order-independent.
function tradeKey(teamBId: string | null, selectedA: Set<number>, selectedB: Set<number>): string {
  const ids = (set: Set<number>) => [...set].sort((x, y) => x - y).join(",");
  return `${teamBId ?? ""}|${ids(selectedA)}|${ids(selectedB)}`;
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
  const vorByFpid = useMemo(
    () => new Map((vorRows ?? []).map((row) => [row.fpid, row])),
    [vorRows],
  );

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

  // What the cards show - VOR, PPG, or overall rank, each season to date
  // and rest of season.
  const [metric, setMetric] = useState<TradeMetric>("ppg");

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
  // Tagged with the trade it was computed for, so the header knows when
  // it's looking at a previous selection's result (shimmer until the new
  // one lands) while the rankings list keeps showing it, dimmed, rather
  // than blinking out on every tap.
  const [tradeImpact, setTradeImpact] = useState<{ key: string; impact: TradeImpact } | undefined>(
    undefined,
  );
  const [tradeImpactError, setTradeImpactError] = useState<{ key: string; message: string } | null>(
    null,
  );
  const currentTradeKey = tradeKey(teamBId, selectedA, selectedB);
  const tradeReady =
    teamAId !== null && teamBId !== null && selectedA.size > 0 && selectedB.size > 0;

  useEffect(() => {
    if (teamAId === null || teamBId === null || selectedA.size === 0 || selectedB.size === 0) {
      setTradeImpact(undefined);
      setTradeImpactError(null);
      return;
    }
    const key = tradeKey(teamBId, selectedA, selectedB);
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
        .then((impact) => setTradeImpact({ key, impact }))
        .catch((err) =>
          setTradeImpactError({
            key,
            message: getErrorMessage(err, "Failed to compute trade impact."),
          }),
        );
    }, 400);
    return () => clearTimeout(timeout);
  }, [seasonId, teamAId, teamBId, selectedA, selectedB, getPowerRankingsWithTrade]);

  // League-wide name pool the cards' short names are collision-checked
  // against - same as the Matchup tab.
  const shortName = useMemo(
    () =>
      buildShortNames([
        ...(vorRows ?? []).map((row) => row.name),
        ...(teamARoster.rows ?? []).flatMap((row) => (row.name ? [row.name] : [])),
        ...(teamBRoster.rows ?? []).flatMap((row) => (row.name ? [row.name] : [])),
      ]),
    [vorRows, teamARoster.rows, teamBRoster.rows],
  );

  const metricSwitch = (
    <GlassSegmented
      label="Card stats"
      value={metric}
      onChange={setMetric}
      options={[
        { label: "VOR", value: "vor" as const },
        { label: "PPG", value: "ppg" as const },
        { label: "Ranks", value: "rank" as const },
      ]}
    />
  );

  // Header and rows hold their shape with glass skeletons while loading,
  // like the Matchup tab, rather than a bare spinner.
  if (nflState === undefined || standings === undefined || vorRows === undefined) {
    return (
      <Stack gap="md">
        <Title order={3}>Trade</Title>
        {metricSwitch}
        <GlassTradeHeader teamA="loading" teamB="loading" />
        <Stack gap={10}>
          <MatchupRosterSkeleton />
        </Stack>
      </Stack>
    );
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

  const selfTeamName = standings.find((row) => row.teamId === teamAId)?.name ?? "Your team";
  const teamBOptions = standings
    .filter((row) => row.teamId !== teamAId)
    .map((row) => ({ value: row.teamId, label: row.name }));
  const teamBName = standings.find((row) => row.teamId === teamBId)?.name ?? "Team";

  // The latest result for the list (possibly a previous selection's,
  // dimmed), and only the current selection's for the header.
  const latestImpact = tradeReady ? tradeImpact?.impact : undefined;
  const impactIsCurrent = tradeImpact?.key === currentTradeKey;
  const impactError = tradeImpactError?.key === currentTradeKey ? tradeImpactError.message : null;

  const beforeRankByTeam = new Map(
    (latestImpact?.before ?? []).map((row, index) => [row.teamId, index + 1]),
  );
  const beforePointsByTeam = new Map(
    (latestImpact?.before ?? []).map((row) => [row.teamId, row.totalProjectedPoints]),
  );

  const headerTeam = (
    teamId: string,
    name: string,
    rows: TeamRosterRow[] | undefined,
    selected: Set<number>,
  ): TradeHeaderTeam => {
    const sending = (rows ?? []).filter((row) => row.fpid !== undefined && selected.has(row.fpid));
    let impact: TradeHeaderTeam["impact"];
    if (tradeReady && !impactError) {
      if (!impactIsCurrent || latestImpact === undefined) {
        impact = "loading";
      } else {
        const afterIndex = latestImpact.after.findIndex((row) => row.teamId === teamId);
        const beforePoints = beforePointsByTeam.get(teamId);
        const after = latestImpact.after[afterIndex];
        impact =
          after === undefined
            ? undefined
            : {
                beforeRank: beforeRankByTeam.get(teamId),
                afterRank: afterIndex + 1,
                pointsDiff:
                  beforePoints !== undefined
                    ? after.totalProjectedPoints - beforePoints
                    : undefined,
              };
      }
    }
    return {
      name,
      sendCount: sending.length,
      // Ranks don't add up, so the Ranks view totals VOR - the value
      // those ranks are ordered by.
      sendValue: sending.reduce((total, row) => {
        const vor = vorByFpid.get(row.fpid ?? -1);
        return total + ((metric === "ppg" ? vor?.rosPpg : vor?.rosVor) ?? 0);
      }, 0),
      valueLabel: metric === "ppg" ? "ROS PPG" : "ROS VOR",
      impact,
    };
  };

  return (
    <Stack gap="md">
      <Title order={3}>Trade</Title>
      {metricSwitch}

      {teamARoster.error && <Alert color="red">{teamARoster.error}</Alert>}
      {teamBRoster.error && <Alert color="red">{teamBRoster.error}</Alert>}
      {impactError && (
        <Alert color="red" withCloseButton onClose={() => setTradeImpactError(null)}>
          {impactError}
        </Alert>
      )}

      <Select
        label="Trading with"
        placeholder="Select a team"
        data={teamBOptions}
        value={teamBId}
        onChange={setTeamBId}
        clearable
        w={{ base: "100%", sm: 220 }}
      />

      <GlassTradeHeader
        teamA={
          teamAId === null || teamARoster.rows === undefined
            ? "loading"
            : headerTeam(teamAId, selfTeamName, teamARoster.rows, selectedA)
        }
        teamB={
          teamBId === null
            ? null
            : teamBRoster.rows === undefined
              ? "loading"
              : headerTeam(teamBId, teamBName, teamBRoster.rows, selectedB)
        }
      />

      <Stack gap={10}>
        {teamARoster.rows === undefined ? (
          <MatchupRosterSkeleton />
        ) : (
          <TradeRosterMatchup
            teamARows={teamARoster.rows}
            teamBRows={teamBRoster.rows}
            teamBLoading={teamBId !== null}
            vorByFpid={vorByFpid}
            metric={metric}
            shortName={shortName}
            selectedA={selectedA}
            selectedB={selectedB}
            onToggleA={toggleA}
            onToggleB={toggleB}
          />
        )}
      </Stack>

      {/* Desktop shows the full list inline - mobile gets a peek card
          pinned above BottomNav instead (see TradePowerRankingsSheet's own
          comment on why), so the two only ever render one at a time via
          visibleFrom/hiddenFrom, never both. */}
      {teamAId !== null && teamBId !== null && latestImpact !== undefined && (
        <>
          <Stack
            gap="xs"
            visibleFrom="sm"
            style={{ opacity: impactIsCurrent ? 1 : 0.5, transition: "opacity 200ms ease" }}
          >
            <Title order={5}>Post-trade power rankings</Title>
            <TradePowerRankingsList
              leagueId={leagueId}
              rows={latestImpact.after}
              beforeRankByTeam={beforeRankByTeam}
              beforePointsByTeam={beforePointsByTeam}
              highlightedTeamIds={new Set([teamAId, teamBId])}
            />
          </Stack>
          <TradePowerRankingsSheet
            leagueId={leagueId}
            rows={latestImpact.after}
            beforeRankByTeam={beforeRankByTeam}
            beforePointsByTeam={beforePointsByTeam}
            teamAId={teamAId}
            teamBId={teamBId}
            teamAName={selfTeamName}
            teamBName={teamBName}
          />
          {/* Reserves room below the page's own content so the fixed/
              portaled peek card above doesn't cover it once scrolled to the
              bottom on mobile - a no-op on desktop, where the peek card
              never renders. */}
          <Box hiddenFrom="sm" h={TRADE_PEEK_CARD_HEIGHT} />
        </>
      )}
    </Stack>
  );
}
