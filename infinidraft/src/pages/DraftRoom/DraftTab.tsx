import { SimpleGrid, Stack, Text } from "@mantine/core";
import { useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { api } from "@infinidata/api";
import type { Doc, Id } from "@infinidata/dataModel";
import { PlayerDetailModal } from "../../components/PlayerDetailModal";
import { GenericValuesNotice } from "../../components/GenericValuesNotice";
import {
  filterRelevantPlayers,
  scoringConfigFromSeason,
} from "../../lib/relevantPlayers";
import { buildStandardValueByFpid } from "../../lib/standardValues";
import { computeNominationSuggestions } from "../../lib/nominationStrategies";
import { WEEK } from "../../constants/general";
import { POSITIONS, type DraftTierRow, type ValueGap } from "../../types";
import { RecentPicksTable } from "./components/RecentPicksTable";
import { TargetsTable } from "./components/ShortlistTable";
import { RecommendedNominations } from "./components/RecommendedNominations";
import { getErrorMessage } from "@shared/errors";
import { useSleeperDraftScheduleRefresh } from "../../hooks/useSleeperDraftScheduleRefresh";
import { formatSleeperDraftSchedule } from "../../lib/sleeperDraftSchedule";

interface DraftTabProps {
  seasonId: Id<"seasons">;
  teams: Doc<"seasonTeams">[];
}

// Search/nominate/bid/resolve all live in DraftTopBar now (shared across
// every Draft Room tab) - this tab is just two audit/reference tables side
// by side: what's already been picked, and the "target"-tagged shortlist
// (see convex/draft/tags.ts) in priority order. Tagging itself still happens
// elsewhere (Players Left's bar click, or the Setup app's Players table);
// this is purely for reviewing/reordering/pruning it.
export function DraftTab({ seasonId, teams }: DraftTabProps) {
  const [selectedFpid, setSelectedFpid] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const settingsList = useQuery(api.leagues.listSeasons, {});
  const settings = settingsList?.find((s) => s._id === seasonId);
  const syncStatus = useQuery(
    api.sleeper.draftSync.getSyncStatus,
    settings?.sleeperSyncEnabled ? { seasonId } : "skip",
  );
  useSleeperDraftScheduleRefresh(
    seasonId,
    settings?.sleeperLeagueId,
    settings?.draftStatus === "pre_draft",
  );
  const thisSeason = settings?.year ?? String(new Date().getFullYear());
  const allProjections = useQuery(api.projections.getAllProjections, {
    week: WEEK,
  });
  const picks = useQuery(api.draft.picks.listDraftPicks, { seasonId });
  const playerTags = useQuery(api.draft.tags.listPlayerTags, {
    seasonId,
  });
  const activeNomination = useQuery(api.draft.picks.getActiveNomination, {
    seasonId,
  });
  const allRankings = useQuery(api.rankings.getAllRankings, { week: WEEK });
  const standardValues = useQuery(api.standardValues.getStandardValues, {
    season: thisSeason,
  });
  const valueGaps = useQuery(
    api.valueGaps.getAllValueGaps,
    settings
      ? {
          week: WEEK,
          scoringConfig: scoringConfigFromSeason(settings),
          lastSeason: String(Number(thisSeason) - 1),
        }
      : "skip",
  );
  const nominationConfig = useQuery(api.draft.nominationOrder.getNominationConfig, {
    seasonId,
  });
  const currentNominator = useQuery(
    api.draft.nominationOrder.getCurrentNominator,
    nominationConfig?.nominationOrder ? { seasonId } : "skip",
  );
  // Same query/args PlayersLeftTab uses - stable for the draft's duration
  // (season settings + projections only), so this is a shared subscription
  // whenever that tab is also mounted, not a second server-side compute.
  const draftBoardResult = useQuery(
    api.draft.board.getDraftBoard,
    settings
      ? {
          seasonId,
          week: WEEK,
          scoringConfig: scoringConfigFromSeason(settings),
        }
      : "skip",
  ) as { isGeneric: boolean; rows: DraftTierRow[] } | undefined;
  const tieredValues = draftBoardResult?.rows;
  const usingGenericValues = draftBoardResult?.isGeneric ?? false;

  const removePick = useMutation(api.draft.picks.removePick);
  const reorderShortlist = useMutation(api.draft.tags.reorderShortlist);
  const clearPlayerTag = useMutation(api.draft.tags.clearPlayerTag);
  const nominate = useMutation(api.draft.picks.nominate);

  const nameByFpid = useMemo(() => {
    const map = new Map<number, { name: string; team: string | null }>();
    for (const row of allProjections ?? []) {
      map.set(row.fpid, row);
    }
    return map;
  }, [allProjections]);

  const teamNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const team of teams) {
      map.set(team._id, team.name);
    }
    return map;
  }, [teams]);

  const teamById = useMemo(() => {
    const map = new Map<string, Doc<"seasonTeams">>();
    for (const team of teams) {
      map.set(team._id, team);
    }
    return map;
  }, [teams]);

  const boardByFpid = useMemo(() => {
    const map = new Map<number, DraftTierRow>();
    for (const row of tieredValues ?? []) map.set(row.fpid, row);
    return map;
  }, [tieredValues]);

  const pickByFpid = useMemo(() => {
    const map = new Map<number, Doc<"draftPicks">>();
    for (const pick of picks ?? []) map.set(pick.fpid, pick);
    return map;
  }, [picks]);

  const recentPicks = useMemo(
    () =>
      [...(picks ?? [])].sort((a, b) => b.sequence - a.sequence).slice(0, 8),
    [picks],
  );

  // Dense order among targets only - a stale/missing order value (e.g. from
  // data written before this field existed) falls back to insertion order
  // rather than corrupting the sort.
  const shortlist = useMemo(() => {
    return (playerTags ?? [])
      .filter((tag) => tag.tag === "target")
      .sort(
        (a, b) =>
          (a.order ?? 0) - (b.order ?? 0) || a._creationTime - b._creationTime,
      )
      .map((tag) => {
        const pick = pickByFpid.get(tag.fpid);
        return {
          tag,
          row: boardByFpid.get(tag.fpid),
          pick,
          draftedByTeam: pick ? teamById.get(pick.teamId) : undefined,
        };
      });
  }, [playerTags, boardByFpid, pickByFpid, teamById]);

  const runAction = async (action: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await action();
    } catch (err) {
      setActionError(getErrorMessage(err, "That action failed."));
    }
  };

  const handleMoveShortlist = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= shortlist.length) return;
    const fpids = shortlist.map(({ tag }) => tag.fpid);
    [fpids[index], fpids[target]] = [fpids[target]!, fpids[index]!];
    runAction(() => reorderShortlist({ seasonId, fpids }));
  };

  // draftStatus is a computed field listSeasons joins in from the real
  // draft's status (see convex/leagues.ts) - "pre_draft" and "!isStarted"
  // are exactly equivalent, same field useDraftPhase reads.
  const isStarted = settings !== undefined && settings.draftStatus !== "pre_draft";

  const activePositions = useMemo(() => {
    if (!settings) return [];
    return POSITIONS.filter(
      (pos) =>
        settings.rosterSlots[pos] > 0 ||
        settings.flexPositions.includes(pos) ||
        settings.superflexPositions.includes(pos),
    );
  }, [settings]);

  const adpByFpid = useMemo(() => {
    const map = new Map<number, { adpStd: number; adpHalf: number; adpPpr: number }>();
    for (const row of allRankings ?? []) map.set(row.fpid, row);
    return map;
  }, [allRankings]);

  const valueGapByFpid = useMemo(() => {
    const map = new Map<number, ValueGap>();
    for (const gap of valueGaps ?? []) map.set(gap.fpid, gap);
    return map;
  }, [valueGaps]);

  const standardValueByFpid = useMemo(
    () =>
      buildStandardValueByFpid(
        standardValues,
        settings?.scoring ?? "PPR",
        (settings?.rosterSlots.SUPERFLEX ?? 0) > 0,
      ),
    [standardValues, settings],
  );

  const availableForNomination = useMemo(() => {
    if (!settings || !tieredValues) return [];
    const relevant = filterRelevantPlayers(
      tieredValues,
      activePositions,
      settings.scoring,
      adpByFpid,
      (row) => row.points,
    );
    return relevant.filter(
      (row) => !pickByFpid.has(row.fpid) && row.fpid !== activeNomination?.fpid,
    );
  }, [settings, tieredValues, activePositions, adpByFpid, pickByFpid, activeNomination]);

  const selfTeamId = teams.find((team) => team.isSelf)?._id;
  const nominatingTeamId = nominationConfig?.nominationOrder
    ? (currentNominator?.currentTeamId ?? undefined)
    : selfTeamId;

  const nominationResults = useMemo(() => {
    if (!settings) return undefined;
    return computeNominationSuggestions({
      available: availableForNomination,
      teams,
      picks: picks ?? [],
      settings: {
        salaryCap: settings.salaryCap,
        rosterSlots: settings.rosterSlots,
        flexPositions: settings.flexPositions,
        superflexPositions: settings.superflexPositions,
      },
      valueGapByFpid,
    });
  }, [settings, availableForNomination, teams, picks, valueGapByFpid]);

  const handleNominate = (fpid: number) =>
    runAction(() =>
      nominate({
        seasonId,
        fpid,
        ...(nominatingTeamId ? { nominatingTeamId } : {}),
        openingBid: 1,
      }),
    );

  return (
    <Stack gap="md" py="sm">
      {actionError && (
        <Text c="red" size="sm">
          {actionError}
        </Text>
      )}
      {!isStarted && settings?.sleeperDraftScheduledAt !== undefined && (
        <Text size="sm">
          Sleeper draft scheduled for{" "}
          <Text component="span" fw={600}>
            {formatSleeperDraftSchedule(settings.sleeperDraftScheduledAt)}
          </Text>
        </Text>
      )}
      {settings?.sleeperSyncEnabled && (
        <Text size="xs" c={syncStatus?.syncError ? "yellow.7" : "dimmed"}>
          {syncStatus?.syncError
            ? `Sleeper sync: ${syncStatus.syncError}`
            : syncStatus?.lastSyncedAt
              ? `Synced from Sleeper - last checked ${new Date(syncStatus.lastSyncedAt).toLocaleTimeString()}`
              : "Sleeper sync starting up..."}
        </Text>
      )}
      {usingGenericValues && <GenericValuesNotice />}
      {isStarted && nominationResults && (
        <RecommendedNominations
          results={nominationResults}
          hasActiveNomination={!!activeNomination}
          onNominate={handleNominate}
          onSelectPlayer={setSelectedFpid}
          standardValueByFpid={standardValueByFpid}
        />
      )}
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <RecentPicksTable
          picks={recentPicks}
          nameByFpid={nameByFpid}
          teamNameById={teamNameById}
          onRemove={(pickId) => runAction(() => removePick({ pickId }))}
          onSelectPlayer={setSelectedFpid}
          trackConsecutiveYears={
            settings?.keeperRules?.maxConsecutiveYears !== undefined
          }
        />
        <TargetsTable
          rows={shortlist}
          onMove={handleMoveShortlist}
          onRemove={(fpid) =>
            runAction(() => clearPlayerTag({ seasonId, fpid }))
          }
          onSelectPlayer={setSelectedFpid}
          standardValueByFpid={standardValueByFpid}
        />
      </SimpleGrid>

      <PlayerDetailModal
        fpid={selectedFpid}
        onClose={() => setSelectedFpid(null)}
        week={WEEK}
        scoringConfig={
          settings
            ? scoringConfigFromSeason(settings)
            : { scoring: "PPR", teScoring: "NONE", sixPointPassTds: false }
        }
        season={thisSeason}
        seasonId={seasonId}
      />
    </Stack>
  );
}
