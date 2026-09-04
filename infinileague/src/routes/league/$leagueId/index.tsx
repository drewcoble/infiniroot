import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useAction, useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import {
  Alert,
  Button,
  Group,
  Loader,
  SegmentedControl,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { RefreshCw } from "lucide-react";
import { api } from "@infinidata/api";
import { StandingsList } from "../../../components/StandingsList";
import { PowerRankingsList } from "../../../components/PowerRankingsList";
import { getErrorMessage } from "@shared/errors";
import { formatRelativeTime } from "../../../lib/relativeTime";
import type {
  LinkedSeason,
  PowerRankingRow,
  StandingsRow,
  TeamPositionRanks,
} from "../../../types/season";

export const Route = createFileRoute("/league/$leagueId/")({
  component: LeaguePage,
});

// Roster data goes stale the moment a draft ends - waivers/trades happen
// continuously in-season, so this can't just trust whatever rosterPlayers
// last had (see infinidraft/INFINILEAGUE.md and this feature's plan doc).
// 15 minutes matches how infrequently rosterPlayers' own schema comment says
// it actually changes ("manually triggered... not high-frequency") without
// re-syncing on literally every page visit.
const ROSTER_STALE_MS = 15 * 60 * 1000;

interface RosterSyncStatusRow {
  teamId: string;
  syncedAt: number;
}

function LeaguePage() {
  const { leagueId } = Route.useParams();
  // Route params are always plain strings - convexApi.ts's FunctionReference
  // types expect the branded Id<"seasons"> convex/values declares, same as
  // infinidraft's own route param (see infinidraft/src/routes/league/
  // $leagueId's usage) - a cast at this one boundary, not threaded through
  // as a real type guarantee.
  const seasonId = leagueId as Id<"seasons">;
  const { isAuthenticated } = useConvexAuth();

  const [tableView, setTableView] = useState<"standings" | "power">(
    "standings",
  );

  const seasonsList: LinkedSeason[] | undefined = useQuery(
    api.leagues.listLinkedSeasons,
    isAuthenticated ? {} : "skip",
  );
  const season = seasonsList?.find((s) => s._id === leagueId);

  const syncStatus: RosterSyncStatusRow[] | undefined = useQuery(
    api.infinileague.season.rosterPlayers.getRosterSyncStatus,
    isAuthenticated ? { seasonId } : "skip",
  );
  const standings: StandingsRow[] | undefined = useQuery(
    api.infinileague.season.standings.getStandings,
    isAuthenticated ? { seasonId } : "skip",
  );
  const syncLeagueRoster = useAction(api.sleeper.league.syncLeagueRoster);

  const getPowerRankings = useAction(
    api.infinileague.season.powerRankings.getPowerRankings,
  );
  const [powerRankings, setPowerRankings] = useState<
    PowerRankingRow[] | undefined
  >(undefined);
  const [powerRankingsError, setPowerRankingsError] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!isAuthenticated) return;
    setPowerRankings(undefined);
    setPowerRankingsError(null);
    getPowerRankings({ seasonId })
      .then(setPowerRankings)
      .catch((err) =>
        setPowerRankingsError(
          getErrorMessage(err, "Failed to load power rankings."),
        ),
      );
    // Refetch whenever the league switches - deliberately excludes
    // getPowerRankings/seasonId itself (derived from leagueId) from deps,
    // same convention as the auto-sync effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, isAuthenticated]);

  // Backs every team card's click-to-expand position radar chart (see
  // StandingsList/PowerRankingsList) - fetched once per league visit
  // rather than per-card-expand, since ranking any one team's positions
  // needs every team's roster gathered anyway (see getTeamPositionRanks).
  // A Set (not a single expanded id) so more than one card can be open at
  // once, same convention infinidraft's DraftReportCard.tsx uses.
  const [expandedTeamIds, setExpandedTeamIds] = useState<Set<string>>(new Set());
  const toggleExpanded = (teamId: string) => {
    setExpandedTeamIds((current) => {
      const next = new Set(current);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  };

  const getTeamPositionRanks = useAction(
    api.infinileague.season.powerRankings.getTeamPositionRanks,
  );
  const [positionRanks, setPositionRanks] = useState<
    TeamPositionRanks[] | undefined
  >(undefined);
  const [positionRanksError, setPositionRanksError] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!isAuthenticated) return;
    setPositionRanks(undefined);
    setPositionRanksError(null);
    getTeamPositionRanks({ seasonId })
      .then(setPositionRanks)
      .catch((err) =>
        setPositionRanksError(
          getErrorMessage(err, "Failed to load position rankings."),
        ),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, isAuthenticated]);
  const positionRanksByTeam = new Map(
    (positionRanks ?? []).map((row) => [row.teamId, row]),
  );

  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  // Guards the auto-sync effect below to firing at most once per mount/
  // league-switch, rather than once per re-render while syncStatus is still
  // undefined (loading).
  const autoSyncedRef = useRef<string | null>(null);

  const lastSyncedAt =
    syncStatus && syncStatus.length > 0
      ? Math.max(...syncStatus.map((row) => row.syncedAt))
      : undefined;
  const isStale =
    lastSyncedAt === undefined || Date.now() - lastSyncedAt > ROSTER_STALE_MS;

  const runSync = async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      await syncLeagueRoster({ seasonId });
    } catch (err) {
      setSyncError(getErrorMessage(err, "Failed to sync roster."));
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    if (syncStatus === undefined) return; // still loading
    if (autoSyncedRef.current === leagueId) return; // already tried this visit
    if (!isStale) return;
    autoSyncedRef.current = leagueId;
    void runSync();
    // Deliberately excludes isStale/runSync from deps - this should fire at
    // most once per (leagueId, syncStatus-has-loaded) transition, not every
    // time isStale's underlying Date.now() comparison would flip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, syncStatus]);

  if (season === undefined) {
    return <Loader />;
  }

  return (
    <Stack gap="md">
      <Title order={2}>{season.name}</Title>
      <Group gap="xs">
        <Text size="sm" c="dimmed">
          {syncing
            ? "Syncing…"
            : lastSyncedAt !== undefined
              ? `Last synced ${formatRelativeTime(lastSyncedAt)}`
              : "Rosters haven't synced yet."}
        </Text>
        <Button
          size="xs"
          variant="default"
          leftSection={<RefreshCw size={14} />}
          onClick={() => void runSync()}
          loading={syncing}
        >
          Sync now
        </Button>
      </Group>
      {syncError && (
        <Alert color="red" withCloseButton onClose={() => setSyncError(null)}>
          {syncError}
        </Alert>
      )}
      {positionRanksError && (
        <Alert
          color="red"
          withCloseButton
          onClose={() => setPositionRanksError(null)}
        >
          {positionRanksError}
        </Alert>
      )}
      <SegmentedControl
        value={tableView}
        onChange={(value) => setTableView(value as "standings" | "power")}
        data={[
          { label: "Standings", value: "standings" },
          { label: "Power rankings", value: "power" },
        ]}
        style={{ alignSelf: "flex-start" }}
      />
      {tableView === "standings" ? (
        standings === undefined ? (
          <Loader />
        ) : (
          <StandingsList
            leagueId={leagueId}
            rows={standings}
            expandedTeamIds={expandedTeamIds}
            onToggleExpand={toggleExpanded}
            positionRanksByTeam={positionRanksByTeam}
          />
        )
      ) : (
        <>
          {powerRankingsError && (
            <Alert
              color="red"
              withCloseButton
              onClose={() => setPowerRankingsError(null)}
            >
              {powerRankingsError}
            </Alert>
          )}
          <PowerRankingsList
            leagueId={leagueId}
            rows={powerRankings}
            expandedTeamIds={expandedTeamIds}
            onToggleExpand={toggleExpanded}
            positionRanksByTeam={positionRanksByTeam}
          />
        </>
      )}
      <Text c="dimmed">
        Waiver recommendations, FAAB bid suggestions, and trade analysis land
        here next.
      </Text>
    </Stack>
  );
}
