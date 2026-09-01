import {
  Badge,
  Button,
  Card,
  Chip,
  Group,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { api } from "@infinidata/api";
import type { Doc, Id } from "@infinidata/dataModel";
import { PlayerDetailModal } from "../../components/PlayerDetailModal";
import { GenericValuesNotice } from "../../components/GenericValuesNotice";
import { SortArrow } from "../../components/SortArrow";
import { getErrorMessage } from "@shared/errors";
import { formatSignedNumber, keeperValueColor } from "../../lib/keeperValue";
import { positionColorOrDefault } from "@shared/positionColors";
import { scoringConfigFromSeason } from "../../lib/relevantPlayers";
import { formatSleeperDraftSchedule } from "../../lib/sleeperDraftSchedule";
import { buildStandardValueByFpid } from "../../lib/standardValues";
import { compareSortValues, type SortDir } from "../../lib/tableSort";
import { buildBlendedAdpByFpid, buildOurRankByFpid } from "../../lib/valueRank";
import { useSleeperDraftScheduleRefresh } from "../../hooks/useSleeperDraftScheduleRefresh";
import { WEEK } from "../../constants/general";
import { POSITIONS, type DraftTierRow, type Position } from "../../types";

// Available-players sort - "Rank" (this app's own cross-position rank, see
// buildOurRankByFpid) is the default rather than raw points, since points
// alone isn't comparable across positions (a top TE scores far fewer points
// than a top WR, so a straight points-desc sort buried every TE below the
// WR/RB pool - user report, 2026-08-30, alongside there being no way to
// change the sort at all before this).
type SortKey = "player" | "rank" | "adp" | "pts";

const DEFAULT_SORT_DIR: Record<SortKey, SortDir> = {
  player: "asc",
  rank: "asc",
  adp: "asc",
  pts: "desc",
};

interface SnakeDraftTabProps {
  seasonId: Id<"seasons">;
  teams: Doc<"seasonTeams">[];
}

// Snake/linear counterpart to DraftTab.tsx - a direct "pick a player" action
// instead of nominate/bid/resolve, so (unlike auction) this is self-
// contained rather than leaning on the persistent DraftTopBar (which stays
// auction-only - see route.tsx). No dollarValue anywhere here (SNAKE_DRAFT.md
// §3.3) - available players are sorted by this app's own cross-position Rank/
// ADP/points instead (sortable, click a header - see SortKey), reusing the
// same getDraftBoard computation auction's board already relies on for those
// same fields.
export function SnakeDraftTab({ seasonId, teams }: SnakeDraftTabProps) {
  const [search, setSearch] = useState("");
  const [positionFilter, setPositionFilter] = useState<Position | null>(null);
  const [pickingTeamId, setPickingTeamId] = useState<Id<"seasonTeams"> | null>(
    null,
  );
  const [selectedFpid, setSelectedFpid] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isPicking, setIsPicking] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortDir, setSortDir] = useState<SortDir>(DEFAULT_SORT_DIR.rank);
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(DEFAULT_SORT_DIR[key]);
    }
  };

  const settingsList = useQuery(api.leagues.listSeasons, {});
  const settings = settingsList?.find((s) => s._id === seasonId);
  const syncStatus = useQuery(
    api.sleeper.draftSync.getSyncStatus,
    settings?.sleeperSyncEnabled ? { seasonId } : "skip",
  );
  const isSuperflex = (settings?.rosterSlots.SUPERFLEX ?? 0) > 0;
  useSleeperDraftScheduleRefresh(
    seasonId,
    settings?.sleeperLeagueId,
    settings?.draftStatus === "pre_draft",
  );
  const thisSeason = settings?.year ?? String(new Date().getFullYear());
  const picks = useQuery(api.draft.picks.listDraftPicks, { seasonId });
  // Same authoritative on-the-clock resolution the TV board uses
  // (findNextOpenSlot, keeper-aware) - draftNominationTurns' turn pointer
  // only self-corrects once the first real pick has been made (see
  // draftPick's comment in convex/draft/picks.ts), so it can disagree with
  // reality while keepers alone occupy the early rotation slots. Reading the
  // same query the board reads guarantees this tab can never show a
  // different "on the clock" team than the TV board does.
  const board = useQuery(api.draft.pickSlots.getSnakeBoardPublic, {
    seasonId,
  });
  const draftOrderConfig = useQuery(api.draft.draftOrder.getDraftOrderConfig, {
    seasonId,
  });
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
  const allRankings = useQuery(api.rankings.getAllRankings, { week: WEEK });
  const standardValues = useQuery(api.standardValues.getStandardValues, {
    season: thisSeason,
  });

  const draftPick = useMutation(api.draft.picks.draftPick);
  const undoLastPick = useMutation(api.draft.picks.undoLastPick);

  const teamNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const team of teams) map.set(team._id, team.name);
    return map;
  }, [teams]);

  // "Picking as" should read top-to-bottom in the order teams actually pick
  // in (board.teamOrder is drafts.draftOrder itself - see
  // getSnakeBoardPublic), not whatever order they happen to sit in `teams`
  // (creation order) - same reasoning as DraftBoard.tsx's teamSummaries sort
  // for auction's nomination order. Falls back to raw `teams` order for any
  // team somehow missing from the configured order.
  const orderedTeams = useMemo(() => {
    const orderIndex = new Map(
      (board?.teamOrder ?? []).map((teamId, index) => [teamId, index]),
    );
    if (orderIndex.size === 0) return teams;
    return [...teams].sort(
      (a, b) =>
        (orderIndex.get(a._id) ?? Infinity) -
        (orderIndex.get(b._id) ?? Infinity),
    );
  }, [teams, board]);

  const pickedFpids = useMemo(
    () => new Set((picks ?? []).map((pick) => pick.fpid)),
    [picks],
  );

  const adpByFpid = useMemo(() => {
    const map = new Map<
      number,
      { adpStd: number; adpHalf: number; adpPpr: number }
    >();
    for (const row of allRankings ?? []) map.set(row.fpid, row);
    return map;
  }, [allRankings]);

  // Same blended ADP/our-rank this app uses everywhere else (PlayersTable.tsx
  // pre-draft, PlayersLeftTab.tsx in-draft) via lib/valueRank.ts, so this
  // tab's numbers never disagree with those - see buildBlendedAdpByFpid/
  // buildOurRankByFpid's own comments for the full reasoning.
  const standardValueByFpid = useMemo(
    () =>
      buildStandardValueByFpid(
        standardValues,
        settings?.scoring ?? "PPR",
        isSuperflex,
      ),
    [standardValues, settings, isSuperflex],
  );
  const blendedAdpByFpid = useMemo(
    () =>
      buildBlendedAdpByFpid(
        adpByFpid,
        standardValueByFpid,
        isSuperflex,
        settings?.scoring ?? "PPR",
      ),
    [adpByFpid, standardValueByFpid, isSuperflex, settings?.scoring],
  );
  const ourRankByFpid = useMemo(
    () =>
      buildOurRankByFpid(
        draftBoardResult?.rows,
        adpByFpid,
        settings?.scoring ?? "PPR",
      ),
    [draftBoardResult, adpByFpid, settings?.scoring],
  );

  const sortValueFor = (
    row: DraftTierRow,
    key: SortKey,
  ): number | string | undefined => {
    switch (key) {
      case "player":
        return row.name;
      case "rank":
        return ourRankByFpid.get(row.fpid);
      case "adp":
        return blendedAdpByFpid.get(row.fpid);
      case "pts":
        return row.points;
    }
  };

  const availableRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = (draftBoardResult?.rows ?? [])
      .filter((row) => !pickedFpids.has(row.fpid))
      .filter((row) => !positionFilter || row.position === positionFilter)
      .filter((row) => !term || row.name.toLowerCase().includes(term));
    // Capped to the top 100 by our own overall rank (not by whatever column
    // is currently sorted) so switching sort columns reorders this same
    // relevant pool instead of swapping in a different set of players - e.g.
    // sorting "Pts" ascending shouldn't surface deep waiver fodder that was
    // never in the pool to begin with.
    const capped = [...filtered]
      .sort(
        (a, b) =>
          (ourRankByFpid.get(a.fpid) ?? Infinity) -
          (ourRankByFpid.get(b.fpid) ?? Infinity),
      )
      .slice(0, 100);
    return capped.sort((a, b) => {
      const primary = compareSortValues(
        sortValueFor(a, sortKey),
        sortValueFor(b, sortKey),
        sortDir,
      );
      if (primary !== 0) return primary;
      return a.name.localeCompare(b.name);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    draftBoardResult,
    pickedFpids,
    positionFilter,
    search,
    sortKey,
    sortDir,
    ourRankByFpid,
    blendedAdpByFpid,
  ]);

  const recentPicks = useMemo(
    () =>
      [...(picks ?? [])].sort((a, b) => b.sequence - a.sequence).slice(0, 10),
    [picks],
  );

  const nameByFpid = useMemo(() => {
    const map = new Map<number, string>();
    for (const row of draftBoardResult?.rows ?? []) {
      map.set(row.fpid, row.name);
    }
    return map;
  }, [draftBoardResult]);

  const renderSortableTh = (label: string, key: SortKey) => (
    <Table.Th onClick={() => handleSort(key)} style={{ cursor: "pointer" }}>
      <Group gap={4} wrap="nowrap">
        <Text size="sm" fw={sortKey === key ? 700 : undefined}>
          {label}
        </Text>
        {sortKey === key && <SortArrow dir={sortDir} />}
      </Group>
    </Table.Th>
  );

  const currentTeamId = board?.onClockTeamId ?? null;
  const effectivePickingTeamId =
    pickingTeamId ?? currentTeamId ?? orderedTeams[0]?._id ?? null;

  const runAction = async (action: () => Promise<unknown>) => {
    setActionError(null);
    setIsPicking(true);
    try {
      await action();
    } catch (err) {
      setActionError(getErrorMessage(err, "That action failed."));
    } finally {
      setIsPicking(false);
    }
  };

  const handleDraft = (fpid: number) => {
    if (!effectivePickingTeamId) return;
    runAction(() =>
      draftPick({ seasonId, fpid, teamId: effectivePickingTeamId }),
    );
  };

  if (draftOrderConfig && !draftOrderConfig.draftOrder) {
    return (
      <Stack gap="md" py="sm">
        {settings?.sleeperDraftScheduledAt !== undefined && (
          <Text size="sm">
            Sleeper draft scheduled for{" "}
            <Text component="span" fw={600}>
              {formatSleeperDraftSchedule(settings.sleeperDraftScheduledAt)}
            </Text>
          </Text>
        )}
        <Text c="dimmed" size="sm">
          Set the draft order in the Teams panel (League Settings) before
          picking.
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="md" py="sm">
      {draftBoardResult?.isGeneric && <GenericValuesNotice />}
      {settings?.draftStatus === "pre_draft" &&
        settings.sleeperDraftScheduledAt !== undefined && (
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
      {actionError && (
        <Text c="red" size="sm">
          {actionError}
        </Text>
      )}
      <Card withBorder padding="md">
        <Group justify="space-between" align="center" wrap="wrap" gap="sm">
          <Stack gap={0}>
            <Text size="sm" c="dimmed">
              {board?.draftStarted ? "On the clock" : "Draft not started"}
            </Text>
            <Text size="lg" fw={700}>
              {currentTeamId ? (teamNameById.get(currentTeamId) ?? "—") : "—"}
            </Text>
          </Stack>
          <Group gap="sm" wrap="wrap">
            <Select
              label="Picking as"
              data={orderedTeams.map((team) => ({
                value: team._id,
                label: team.name,
              }))}
              value={effectivePickingTeamId}
              onChange={(value) =>
                setPickingTeamId(value as Id<"seasonTeams"> | null)
              }
              allowDeselect={false}
              w={200}
            />
            <Button
              variant="default"
              mt={20}
              disabled={!recentPicks.length}
              onClick={() => runAction(() => undoLastPick({ seasonId }))}
            >
              Undo last pick
            </Button>
          </Group>
        </Group>
      </Card>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <Card withBorder padding="md">
          <Stack gap="sm">
            <Text size="sm" fw={500}>
              Available players
            </Text>
            <TextInput
              placeholder="Search players"
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
            />
            <Group gap={6}>
              <Chip
                checked={positionFilter === null}
                onChange={() => setPositionFilter(null)}
                variant="light"
              >
                All
              </Chip>
              {POSITIONS.map((pos) => (
                <Chip
                  key={pos}
                  checked={positionFilter === pos}
                  onChange={() => setPositionFilter(pos)}
                  color={positionColorOrDefault(pos)}
                  variant="light"
                >
                  {pos}
                </Chip>
              ))}
            </Group>
            <Table.ScrollContainer minWidth={360} mah={480}>
              <Table striped highlightOnHover verticalSpacing={4}>
                <Table.Thead>
                  <Table.Tr>
                    {renderSortableTh("Rank", "rank")}
                    {renderSortableTh("Player", "player")}
                    {renderSortableTh("ADP", "adp")}
                    <Table.Th>vs ADP</Table.Th>
                    {renderSortableTh("Pts", "pts")}
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {availableRows.map((row) => {
                    const adp = blendedAdpByFpid.get(row.fpid);
                    const ourRank = ourRankByFpid.get(row.fpid);
                    const diff =
                      ourRank !== undefined && adp !== undefined
                        ? Math.round(adp) - ourRank
                        : undefined;
                    return (
                      <Table.Tr key={row.fpid}>
                        <Table.Td>
                          <Text size="sm" fw={700}>
                            {ourRank !== undefined ? ourRank : "—"}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Group gap={6} wrap="nowrap">
                            <Badge
                              size="sm"
                              variant="light"
                              color={positionColorOrDefault(row.position)}
                            >
                              {row.position}
                            </Badge>
                            <Text
                              size="sm"
                              component="button"
                              onClick={() => setSelectedFpid(row.fpid)}
                              style={{
                                background: "none",
                                border: "none",
                                cursor: "pointer",
                                padding: 0,
                                textAlign: "left",
                              }}
                            >
                              {row.name}
                            </Text>
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          {adp !== undefined ? adp.toFixed(1) : "—"}
                        </Table.Td>
                        <Table.Td>
                          {diff !== undefined ? (
                            <Text size="sm" fw={600} c={keeperValueColor(diff)}>
                              {formatSignedNumber(diff)}
                            </Text>
                          ) : (
                            "—"
                          )}
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm" c="dimmed">
                            {row.points.toFixed(1)}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Button
                            size="xs"
                            disabled={isPicking || !effectivePickingTeamId}
                            onClick={() => handleDraft(row.fpid)}
                          >
                            Draft
                          </Button>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Stack>
        </Card>

        <Card withBorder padding="md">
          <Stack gap="sm">
            <Text size="sm" fw={500}>
              Recent picks
            </Text>
            {recentPicks.length === 0 ? (
              <Text size="sm" c="dimmed">
                No picks yet.
              </Text>
            ) : (
              <Table.ScrollContainer minWidth={360}>
                <Table striped highlightOnHover verticalSpacing={4}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Pick</Table.Th>
                      <Table.Th>Player</Table.Th>
                      <Table.Th>Team</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {recentPicks.map((pick) => (
                      <Table.Tr key={pick._id}>
                        <Table.Td>
                          {pick.round !== undefined &&
                          pick.pickInRound !== undefined
                            ? `${pick.round}.${String(pick.pickInRound).padStart(2, "0")}`
                            : `#${pick.sequence}`}
                        </Table.Td>
                        <Table.Td>
                          {nameByFpid.get(pick.fpid) ?? `#${pick.fpid}`}
                        </Table.Td>
                        <Table.Td>
                          {teamNameById.get(pick.teamId) ?? "—"}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
          </Stack>
        </Card>
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
