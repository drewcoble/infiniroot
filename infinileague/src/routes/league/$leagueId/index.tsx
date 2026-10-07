import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useAction, useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { Alert, Stack, Text, Title } from "@mantine/core";
import { RefreshCw } from "lucide-react";
import { api } from "@infinidata/api";
import { StandingsList } from "../../../components/StandingsList";
import { PowerRankingsList } from "../../../components/PowerRankingsList";
import { EliminationWatchList } from "../../../components/EliminationWatchList";
import { GlassRosterSkeletonCard } from "../../../components/cards/GlassRosterCard";
import { GlassSegmented } from "../../../components/cards/GlassSegmented";
import classes from "../../../components/cards/GlassMatchupCard.module.css";
import { getErrorMessage } from "@shared/errors";
import { formatRelativeTime } from "../../../lib/relativeTime";
import type {
  EliminationWatchRow,
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

  // null = no manual pick yet, so the tab defaults to Elimination Watch for
  // a guillotine league (win/loss doesn't mean anything without head-to-
  // head games) or Standings otherwise - see the tableView derivation
  // below. Once the viewer picks a tab themselves, that choice sticks
  // regardless of which league format this turns out to be.
  const [manualTableView, setManualTableView] = useState<
    "standings" | "power" | "elimination" | null
  >(null);

  const seasonsList: LinkedSeason[] | undefined = useQuery(
    api.leagues.listLinkedSeasons,
    isAuthenticated ? {} : "skip",
  );
  const season = seasonsList?.find((s) => s._id === leagueId);
  const isGuillotine = season?.leagueType === "guillotine";
  const tableView =
    manualTableView ?? (isGuillotine ? "elimination" : "standings");

  const syncStatus: RosterSyncStatusRow[] | undefined = useQuery(
    api.infinileague.season.rosterPlayers.getRosterSyncStatus,
    isAuthenticated ? { seasonId } : "skip",
  );
  const standings: StandingsRow[] | undefined = useQuery(
    api.infinileague.season.standings.getStandings,
    isAuthenticated ? { seasonId } : "skip",
  );
  const syncSleeperRoster = useAction(api.sleeper.league.syncLeagueRoster);
  const syncYahooRoster = useAction(
    api.infinidraft.yahoo.league.syncYahooLeagueRoster,
  );

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

  const getEliminationWatch = useAction(
    api.infinileague.season.eliminationWatch.getEliminationWatch,
  );
  const [eliminationWatch, setEliminationWatch] = useState<
    EliminationWatchRow[] | undefined
  >(undefined);
  const [eliminationWatchError, setEliminationWatchError] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (!isAuthenticated || !isGuillotine) return;
    setEliminationWatch(undefined);
    setEliminationWatchError(null);
    getEliminationWatch({ seasonId })
      .then(setEliminationWatch)
      .catch((err) =>
        setEliminationWatchError(
          getErrorMessage(err, "Failed to load elimination watch."),
        ),
      );
    // Same dep convention as the getPowerRankings effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, isAuthenticated, isGuillotine]);

  // Backs every team card's long-press popover radar chart (see
  // GlassTeamCard) - fetched once per league visit rather than per popover,
  // since ranking any one team's positions needs every team's roster
  // gathered anyway (see getTeamPositionRanks).
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
    if (!season) return; // not loaded yet - nothing to branch on
    setSyncing(true);
    setSyncError(null);
    try {
      if (season.yahooLeagueKey) {
        await syncYahooRoster({ seasonId });
      } else {
        await syncSleeperRoster({ seasonId });
      }
    } catch (err) {
      setSyncError(getErrorMessage(err, "Failed to sync roster."));
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    if (syncStatus === undefined) return; // still loading
    if (season === undefined) return; // still loading - runSync needs it to pick a provider
    if (autoSyncedRef.current === leagueId) return; // already tried this visit
    if (!isStale) return;
    autoSyncedRef.current = leagueId;
    void runSync();
    // Deliberately excludes isStale/runSync from deps - this should fire at
    // most once per (leagueId, syncStatus-has-loaded) transition, not every
    // time isStale's underlying Date.now() comparison would flip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, syncStatus, season]);

  if (season === undefined) {
    return (
      <Stack gap="md">
        <span className={classes.skeletonBar} style={{ width: "55%", height: 22 }} />
        <span className={classes.skeletonBar} style={{ height: 42 }} />
        <Stack gap={8}>
          {Array.from({ length: 8 }, (_, index) => (
            <GlassRosterSkeletonCard key={index} />
          ))}
        </Stack>
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      {/* League name in the same title style as the other tabs, with the
          roster sync's status quietly under it and the sync itself as a
          round glass button - a status line rather than a toolbar. */}
      <div className={classes.pageHeader}>
        <div style={{ minWidth: 0 }}>
          <Title order={3}>{season.name}</Title>
          <div className={classes.pageHeaderStatus} aria-live="polite">
            {syncing
              ? "Syncing rosters…"
              : lastSyncedAt !== undefined
                ? `Synced ${formatRelativeTime(lastSyncedAt)}`
                : "Rosters haven't synced yet"}
          </div>
        </div>
        <button
          type="button"
          className={classes.glassIconButton}
          onClick={() => void runSync()}
          disabled={syncing}
          aria-label={syncing ? "Syncing rosters" : "Sync rosters now"}
        >
          <RefreshCw size={16} strokeWidth={2.5} className={syncing ? classes.spinning : undefined} />
        </button>
      </div>
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
      <GlassSegmented
        label="League view"
        value={tableView}
        onChange={setManualTableView}
        options={[
          // Standings' win/loss record doesn't mean anything in a
          // guillotine league (no head-to-head games) - swapped for
          // Elimination Watch instead, same tab slot. Power rankings is
          // unaffected either way.
          isGuillotine
            ? { label: "Elimination Watch", value: "elimination" as const }
            : { label: "Standings", value: "standings" as const },
          { label: "Power rankings", value: "power" as const },
        ]}
      />
      {tableView === "elimination" ? (
        <>
          {eliminationWatchError && (
            <Alert
              color="red"
              withCloseButton
              onClose={() => setEliminationWatchError(null)}
            >
              {eliminationWatchError}
            </Alert>
          )}
          <EliminationWatchList
            leagueId={leagueId}
            rows={eliminationWatch}
            positionRanksByTeam={positionRanksByTeam}
          />
        </>
      ) : tableView === "standings" ? (
        standings === undefined ? (
          <Stack gap={8}>
            {Array.from({ length: 8 }, (_, index) => (
              <GlassRosterSkeletonCard key={index} />
            ))}
          </Stack>
        ) : (
          <StandingsList
            leagueId={leagueId}
            rows={standings}
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
