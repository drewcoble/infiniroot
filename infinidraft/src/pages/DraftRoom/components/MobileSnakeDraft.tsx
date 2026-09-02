import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Chip,
  Group,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { useMutation, useQuery } from "convex/react";
import { ListChecks, X } from "lucide-react";
import { api } from "@infinidata/api";
import type { Doc, Id } from "@infinidata/dataModel";
import { SortArrow } from "../../../components/SortArrow";
import { PlayerDetailModal } from "../../../components/PlayerDetailModal";
import { WEEK } from "../../../constants/general";
import { getErrorMessage } from "@shared/errors";
import { formatSignedNumber, keeperValueColor } from "../../../lib/keeperValue";
import { positionColorOrDefault } from "@shared/positionColors";
import { scoringConfigFromSeason } from "../../../lib/relevantPlayers";
import { buildStandardValueByFpid } from "../../../lib/standardValues";
import { compareSortValues, type SortDir } from "../../../lib/tableSort";
import {
  buildBlendedAdpByFpid,
  buildOurRankByFpid,
} from "../../../lib/valueRank";
import { POSITIONS, type DraftTierRow, type Position } from "../../../types";
import { BottomSheet, DraftFab, TeamChipRow } from "./mobileDraftSheet";

interface MobileSnakeDraftProps {
  seasonId: Id<"seasons">;
  teams: Doc<"seasonTeams">[];
}

// Same sort convention as SnakeDraftTab.tsx's own SortKey (the desktop
// equivalent of this sheet) - "Rank" (this app's own cross-position rank)
// defaults first rather than raw points, which isn't comparable across
// positions. User report, 2026-08-30: this was the primary mobile drafting
// surface, fixed-sorted by points with no way to change it, and showing
// row.positionRank (e.g. "RB12") mislabeled "Rk" instead of the app's real
// overall rank used everywhere else.
type SortKey = "rank" | "adp" | "pts";

const DEFAULT_SORT_DIR: Record<SortKey, SortDir> = {
  rank: "asc",
  adp: "asc",
  pts: "desc",
};

// Snake/linear counterpart to MobileNomination's nominate/assign FAB - the
// mobile way to actually make a pick, reachable from every Draft Room tab
// rather than only the Draft one (SnakeDraftTab's inline table is the
// desktop equivalent, and stays as-is). Self-contained the same way
// SnakeDraftTab is: there's no snake analog of auction's DraftTopBar to
// thread props down from, and Convex dedupes identical query subscriptions,
// so re-querying here costs nothing extra when the Draft tab is also
// mounted (same reasoning DraftTab.tsx's getDraftBoard comment gives).
export function MobileSnakeDraft({ seasonId, teams }: MobileSnakeDraftProps) {
  const [opened, setOpened] = useState(false);
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
  const isSuperflex = (settings?.rosterSlots.SUPERFLEX ?? 0) > 0;
  const thisSeason = settings?.year ?? String(new Date().getFullYear());
  const picks = useQuery(api.infinidraft.draft.picks.listDraftPicks, { seasonId });
  // Same authoritative on-the-clock/pick-numbering source the TV board and
  // SnakeDraftTab both read, so this sheet can never disagree with either
  // about whose turn it is or which pick number is up (see
  // getSnakeBoardPublic - the turn pointer alone can lag while keepers
  // occupy early rotation slots).
  const board = useQuery(api.infinidraft.draft.pickSlots.getSnakeBoardPublic, { seasonId });
  const draftBoardResult = useQuery(
    api.infinidraft.draft.board.getDraftBoard,
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

  const draftPick = useMutation(api.infinidraft.draft.picks.draftPick);

  // Same ordering rationale as SnakeDraftTab's - the chip row should read in
  // the order teams actually pick in (board.teamOrder is drafts.draftOrder
  // itself), not their creation order in `teams`.
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
  // pre-draft, PlayersLeftTab.tsx in-draft, SnakeDraftTab.tsx's desktop
  // equivalent of this sheet) via lib/valueRank.ts, so this never disagrees
  // with those on the same player.
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
  ): number | undefined => {
    switch (key) {
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
    // Capped to the top 100 by our own overall rank (not whatever column is
    // currently sorted) so switching sort columns reorders this same
    // relevant pool rather than swapping in a different set of players - see
    // SnakeDraftTab.tsx's identical comment.
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

  const currentTeamId = board?.onClockTeamId ?? null;
  const effectivePickingTeamId =
    pickingTeamId ?? currentTeamId ?? orderedTeams[0]?._id ?? null;

  // "1.01, 1/150" - round.pickInRound from the on-the-clock cell (the board
  // already resolved which position is up, trades/forfeits/keepers included),
  // then this pick's overall number out of the draft's real slot total.
  const pickLabel = useMemo(() => {
    if (!board || board.onClockRound === null) return null;
    const round = board.rounds.find((r) => r.round === board.onClockRound);
    const cell = round?.cells.find((c) => c.isOnClock);
    if (!cell) return null;
    return `${board.onClockRound}.${String(cell.position).padStart(2, "0")}, ${board.currentOverallPick}/${board.totalPicks}`;
  }, [board]);

  const handleDraft = async (fpid: number) => {
    if (!effectivePickingTeamId) return;
    setActionError(null);
    setIsPicking(true);
    try {
      await draftPick({ seasonId, fpid, teamId: effectivePickingTeamId });
      // Same "one pick per open" flow as the nominate sheet - a completed
      // pick closes the sheet (and clears the search that found it) rather
      // than leaving a now-stale list open over the page.
      setSearch("");
      setOpened(false);
    } catch (err) {
      setActionError(getErrorMessage(err, "That action failed."));
    } finally {
      setIsPicking(false);
    }
  };

  // Nothing to pick into until an order exists - same guard SnakeDraftTab
  // shows its own message for, just silent here since a FAB has no room to
  // explain itself.
  if (board && board.teamOrder.length === 0) return null;

  return (
    <>
      <DraftFab
        icon={opened ? <X size={24} /> : <ListChecks size={24} />}
        label={opened ? "Close draft a player" : "Draft a player"}
        onClick={() => setOpened((current) => !current)}
      />

      <BottomSheet opened={opened} onDismiss={() => setOpened(false)}>
        <Stack gap={10}>
          <Group justify="space-between" wrap="nowrap" align="flex-start">
            <Stack gap={0} style={{ minWidth: 0 }}>
              <Text fw={700} size="lg">
                Draft a Player
              </Text>
              {pickLabel && (
                <Text size="sm" c="dimmed">
                  {pickLabel}
                </Text>
              )}
            </Stack>
            <Button
              variant="default"
              size="xs"
              radius="xl"
              onClick={() => setOpened(false)}
            >
              Close
            </Button>
          </Group>

          {actionError && (
            <Text c="red" size="sm">
              {actionError}
            </Text>
          )}

          <Stack gap={4}>
            <Text size="sm" c="dimmed">
              Picking as
              {currentTeamId && (
                <>
                  {" · on the clock: "}
                  <Text component="span" inherit fw={600} c="saddlebrown.5">
                    {teams.find((t) => t._id === currentTeamId)?.name ?? "—"}
                  </Text>
                </>
              )}
            </Text>
            <TeamChipRow
              teams={orderedTeams.map((team) => ({
                id: team._id,
                label: team.name,
              }))}
              selectedId={effectivePickingTeamId}
              onSelect={(id) => setPickingTeamId(id)}
            />
          </Stack>

          <TextInput
            placeholder="Search players"
            value={search}
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
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

          <Table.ScrollContainer minWidth={340}>
            <Table highlightOnHover verticalSpacing={8}>
              <Table.Thead>
                <Table.Tr>
                  {(["rank"] as const).map((key) => (
                    <Table.Th
                      key={key}
                      onClick={() => handleSort(key)}
                      style={{ cursor: "pointer" }}
                    >
                      <Group gap={2} wrap="nowrap">
                        <Text size="xs" fw={sortKey === key ? 700 : undefined}>
                          Rk
                        </Text>
                        {sortKey === key && (
                          <SortArrow dir={sortDir} size={10} />
                        )}
                      </Group>
                    </Table.Th>
                  ))}
                  <Table.Th>Player</Table.Th>
                  {(["adp", "pts"] as const).map((key) => (
                    <Table.Th
                      key={key}
                      onClick={() => handleSort(key)}
                      style={{ cursor: "pointer" }}
                    >
                      <Group gap={2} wrap="nowrap">
                        <Text size="xs" fw={sortKey === key ? 700 : undefined}>
                          {key === "adp" ? "ADP" : "Pts"}
                        </Text>
                        {sortKey === key && (
                          <SortArrow dir={sortDir} size={10} />
                        )}
                      </Group>
                    </Table.Th>
                  ))}
                  <Table.Th>vs ADP</Table.Th>
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
                        <Text size="sm">
                          {adp !== undefined ? adp.toFixed(1) : "—"}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" c="dimmed">
                          {row.points.toFixed(1)}
                        </Text>
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
      </BottomSheet>

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
    </>
  );
}
