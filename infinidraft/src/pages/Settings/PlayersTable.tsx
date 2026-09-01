import { convexQuery } from "@convex-dev/react-query";
import {
  Box,
  Card,
  Center,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { useQuery as useTanStackQuery } from "@tanstack/react-query";
import { useMutation, useQuery } from "convex/react";
import { Search } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { api } from "@infinidata/api";
import type { Doc, Id } from "@infinidata/dataModel";
import { GenericValuesNotice } from "../../components/GenericValuesNotice";
import { PlayerDetailModal } from "../../components/PlayerDetailModal";
import { PositionFilterBar } from "../../components/PositionFilterBar";
import { SortArrow } from "../../components/SortArrow";
import { POSITION_FILTER_BAR_HEIGHT } from "../../constants/general";
import { MOBILE_HEADER_HEIGHT } from "@shared/constants";
import { useRookieFpids } from "../../hooks/useRookieFpids";
import {
  computeConsistencyThresholds,
  getConsistencyLabel,
  type ConsistencyLabel,
} from "../../lib/consistency";
import {
  filterRelevantPlayers,
  pointsForScoringConfig,
  scoringConfigFromSeason,
} from "../../lib/relevantPlayers";
import { buildStandardValueByFpid } from "../../lib/standardValues";
import { compareSortValues, type SortDir } from "../../lib/tableSort";
import { buildBlendedAdpByFpid, buildOurRankByFpid } from "../../lib/valueRank";
import {
  POSITIONS,
  type DraftTierRow,
  type PlayerTag,
  type Position,
  type ScoringConfig,
  type ValueGap,
} from "../../types";
import { AiInsightsCard } from "./components/AiInsightsCard";
import { PlayerRow, type KeeperInfo } from "./components/PlayerRow";
import { PlayerRowMobile } from "./components/PlayerRowMobile";

interface PlayersTableProps {
  week: string;
  selectedLeagueId: Id<"seasons"> | undefined;
}

type SortKey =
  "player" | "team" | "tier" | "dollar" | "market" | "pts" | "rank";

// Direction a column sorts to the first time it's clicked - numeric value
// columns default to "best first" (highest $/points, lowest/best tier),
// text columns default A-Z. Clicking the same header again flips it.
const DEFAULT_SORT_DIR: Record<SortKey, SortDir> = {
  player: "asc",
  team: "asc",
  tier: "asc",
  dollar: "desc",
  market: "desc",
  pts: "desc",
  rank: "desc",
};

// "dollar"/"rank" are auction's $ value (highest first) but snake/linear's
// ADP/our-own-rank (lowest/earliest number first) - the two defaults that
// flip per format. "market"/vs-ADP both want "best value first" (highest
// positive diff), so that one doesn't need a format-aware override.
function defaultSortDirFor(key: SortKey, isAuction: boolean): SortDir {
  if ((key === "dollar" || key === "rank") && !isAuction) return "asc";
  return DEFAULT_SORT_DIR[key];
}

export function PlayersTable({ week, selectedLeagueId }: PlayersTableProps) {
  const [selectedPositions, setSelectedPositions] = useState<Position[]>([
    ...POSITIONS,
  ]);
  const [selectedFpid, setSelectedFpid] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  // Which rows' target/avoid toggle + Keeper info is showing - dropped from
  // the main row (see PlayerRow.tsx) to fit mobile widths, same
  // click-to-expand pattern InjuryReport.tsx uses.
  const [expandedIds, setExpandedIds] = useState<Set<Id<"projections">>>(
    new Set(),
  );
  const toggleExpanded = (id: Id<"projections">) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };
  // Mobile table view's counterpart to expandedIds above - only one row's
  // Target/Avoid actions are ever swiped open at a time (see
  // PlayerRowMobile.tsx), rather than each row tracking its own.
  const [swipedId, setSwipedId] = useState<Id<"projections"> | null>(null);
  // null until a column header's been clicked - the table keeps its
  // existing $ > position rank default order (see sortedRows below) until
  // then, rather than starting on some arbitrary explicit column.
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(defaultSortDirFor(key, isAuction));
    }
  };

  const allProjections = useQuery(api.projections.getAllProjections, {
    week,
  });
  const allRankings = useQuery(api.rankings.getAllRankings, { week });
  const injuries = useQuery(api.injuries.getInjuries, {});
  const rookieFpids = useRookieFpids();
  const draftSettingsList = useQuery(api.leagues.listSeasons, {});
  const selectedSettings = draftSettingsList?.find(
    (league) => league._id === selectedLeagueId,
  );
  const seasonId = selectedSettings?._id;
  // AUCTION.md/SNAKE.md's standard `(settings.draftType ?? "auction") ===
  // "auction"` frontend pattern - determines whether the value columns show
  // $-vs-market (auction) or ADP-vs-our-rank (snake/linear).
  const isAuction = (selectedSettings?.draftType ?? "auction") === "auction";
  // Scoring format now lives on the league settings (edited on the Settings
  // tab) instead of local component state, so it's shared/persisted rather
  // than resetting per-tab-visit.
  const scoring = selectedSettings?.scoring ?? "PPR";
  const scoringConfig: ScoringConfig = useMemo(
    () =>
      selectedSettings
        ? scoringConfigFromSeason(selectedSettings)
        : { scoring, teScoring: "NONE", sixPointPassTds: false },
    [selectedSettings, scoring],
  );
  const thisSeason = selectedSettings?.year ?? String(new Date().getFullYear());
  const lastSeason = String(Number(thisSeason) - 1);
  const valueGaps = useQuery(api.valueGaps.getAllValueGaps, {
    week,
    scoringConfig,
    lastSeason,
  });
  // ESPN's own draft-kit $ values, for an at-a-glance market comparison
  // against this league's own computed $ (see StandardValueLabel). Fetched
  // for the CURRENT season regardless of which season's projections are
  // showing - ESPN's ranks aren't a per-season-selectable historical thing
  // the way projections/valueGaps are.
  const standardValues = useQuery(api.standardValues.getStandardValues, {
    season: thisSeason,
  });
  const isSuperflex = (selectedSettings?.rosterSlots.SUPERFLEX ?? 0) > 0;
  const standardValueByFpid = useMemo(
    () => buildStandardValueByFpid(standardValues, scoring, isSuperflex),
    [standardValues, scoring, isSuperflex],
  );
  // Consistency rating (see src/lib/consistency.ts) - PPG/variance relative
  // to the rest of each position's cohort, so it doesn't need a league
  // selected (unlike the old replacement-rank cutoff, which did).
  const seasonStats = useQuery(api.playerPoints.getAllSeasonStats, {
    season: lastSeason,
    scoringConfig,
  });
  const consistencyByFpid = useMemo(() => {
    const map = new Map<number, ConsistencyLabel>();
    if (!seasonStats) return map;
    const byPosition = new Map<Position, typeof seasonStats>();
    for (const row of seasonStats) {
      const list = byPosition.get(row.position) ?? [];
      list.push(row);
      byPosition.set(row.position, list);
    }
    for (const [position, rows] of byPosition) {
      const thresholds = computeConsistencyThresholds(position, rows);
      for (const row of rows) {
        const label = getConsistencyLabel(position, row, thresholds);
        if (label) map.set(row.fpid, label);
      }
    }
    return map;
  }, [seasonStats]);
  // Same draftPlayerTags table the in-draft Players Left tab reads/writes
  // (see convex/draft/tags.ts) - marking a target/avoid here shows up there
  // too, and vice versa, since both key off seasonId.
  const playerTags = useQuery(
    api.infinidraft.draft.tags.listPlayerTags,
    seasonId ? { seasonId } : "skip",
  );
  const cyclePlayerTag = useMutation(api.infinidraft.draft.tags.cyclePlayerTag);
  const setPlayerTag = useMutation(api.infinidraft.draft.tags.setPlayerTag);
  const tagByFpid = useMemo(() => {
    const map = new Map<number, PlayerTag>();
    for (const row of playerTags ?? []) map.set(row.fpid, row.tag);
    return map;
  }, [playerTags]);

  // Keeper column - the actual cost/year entered for this player on the
  // Keepers tab (see KeepersTab.tsx's addKeeper), not a projected/suggested
  // cost from the keeper rules formula.
  const picks = useQuery(
    api.infinidraft.draft.picks.listDraftPicks,
    seasonId ? { seasonId } : "skip",
  );
  const showKeeperYear =
    selectedSettings?.keeperRules?.maxConsecutiveYears !== undefined;
  const keeperInfoByFpid = useMemo(() => {
    const map = new Map<number, KeeperInfo>();
    for (const pick of picks ?? []) {
      if (!pick.isKeeper) continue;
      map.set(pick.fpid, { price: pick.price, streak: pick.keeperStreak });
    }
    return map;
  }, [picks]);
  // A position only matters to the selected league if it fills a dedicated
  // roster slot or is FLEX/SUPERFLEX-eligible - e.g. a 0-K league shouldn't
  // show a K pill or any kickers. Fall back to every position while the
  // league's settings are still loading so nothing flashes empty.
  const activePositions = useMemo(() => {
    if (!selectedSettings) return [...POSITIONS];
    return POSITIONS.filter(
      (pos) =>
        selectedSettings.rosterSlots[pos] > 0 ||
        selectedSettings.flexPositions.includes(pos) ||
        selectedSettings.superflexPositions.includes(pos),
    );
  }, [selectedSettings]);
  // TanStack Query (via convexQuery) instead of plain Convex useQuery here:
  // switching scoring format changes this query's args, and
  // placeholderData keeps showing the previous result (with isFetching
  // flagging a background recalc) instead of the $ column/sort disappearing
  // and reappearing on every scoring click.
  //
  // Use Convex's own "skip" convention rather than TanStack's `enabled`
  // option to conditionally disable this query - convexQuery's `enabled`
  // support is currently broken (the query fires even when disabled; see
  // https://github.com/get-convex/convex-react-query/issues/5), but "skip"
  // is handled correctly.
  // getDraftBoard (not the narrower getDraftValues) so this table gets the
  // same tier field the Draft Room's own tables compute - it wraps
  // getDraftValues with tiers on top of the identical args, so this is a
  // pure superset, not a second computation to keep in sync.
  const draftValuesQueryOptions = convexQuery(
    api.infinidraft.draft.board.getDraftBoard,
    seasonId ? { seasonId, week, scoringConfig } : "skip",
  );
  interface DraftValuesResult {
    isGeneric: boolean;
    rows: DraftTierRow[];
  }
  const { data: draftValuesResult, isFetching: isRecalculatingValues } =
    useTanStackQuery<DraftValuesResult>({
      ...draftValuesQueryOptions,
      placeholderData: (previousData: DraftValuesResult | undefined) =>
        previousData,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  const draftValues = draftValuesResult?.rows;
  // True only for the very first fetch of $ values for a selected league -
  // sortedRows falls back to raw-points sort until draftValues exists, so
  // rendering the table during this window would show players in points
  // order and then jump them into $-value order once the fetch resolves.
  // Later scoring-format switches don't hit this (placeholderData keeps the
  // previous league's $ values in place while refetching), so the table
  // keeps updating in place instead of blanking out.
  //
  // Gating on seasonId alone flashes the table: draftSettingsList
  // (and therefore seasonId) starts undefined on mount, so the first
  // render slips through as "no league selected" and shows the table
  // points-sorted, then hides it again once seasonId resolves and
  // draftValues is still loading. Waiting on draftSettingsList too closes
  // that gap - unless the selected league never resolves to a settings row
  // (e.g. it was deleted), in which case draftValues will never fire and we
  // fall through to the points-sorted table instead of spinning forever.
  const isInitialValuesLoad =
    selectedLeagueId !== undefined &&
    (draftSettingsList === undefined ||
      (seasonId !== undefined && draftValues === undefined));

  const injuriesByFpid = useMemo(() => {
    const map = new Map<number, { status: string; statusShort: string }>();
    for (const injury of injuries ?? []) {
      map.set(injury.fpid, injury);
    }
    return map;
  }, [injuries]);

  const adpByFpid = useMemo(() => {
    const map = new Map<
      number,
      { adpStd: number; adpHalf: number; adpPpr: number }
    >();
    for (const ranking of allRankings ?? []) {
      map.set(ranking.fpid, ranking);
    }
    return map;
  }, [allRankings]);

  const valueGapByFpid = useMemo(() => {
    const map = new Map<number, ValueGap>();
    for (const gap of valueGaps ?? []) map.set(gap.fpid, gap);
    return map;
  }, [valueGaps]);

  const draftValueByFpid = useMemo(() => {
    const map = new Map<
      number,
      {
        dollarValue: number;
        usedFallback: boolean;
        positionRank: number;
        tier: number;
        tierLabel: string;
      }
    >();
    for (const value of draftValues ?? []) {
      map.set(value.fpid, value);
    }
    return map;
  }, [draftValues]);

  // Snake/linear's "ADP" and "our rank" columns - shared with
  // PlayersLeftTab.tsx (in-draft) via lib/valueRank.ts's
  // buildBlendedAdpByFpid/buildOurRankByFpid, so the two never compute a
  // different number for the same player. See those functions' own
  // comments for the full reasoning.
  const blendedAdpByFpid = useMemo(
    () =>
      buildBlendedAdpByFpid(
        adpByFpid,
        standardValueByFpid,
        isSuperflex,
        scoring,
      ),
    [adpByFpid, standardValueByFpid, isSuperflex, scoring],
  );
  const ourRankByFpid = useMemo(
    () => buildOurRankByFpid(draftValues, adpByFpid, scoring),
    [draftValues, adpByFpid, scoring],
  );

  const relevantProjections = useMemo(() => {
    if (!allProjections) return [];
    return filterRelevantPlayers(
      allProjections,
      activePositions,
      scoring,
      adpByFpid,
      (row) => pointsForScoringConfig(row, scoringConfig),
    );
  }, [allProjections, adpByFpid, scoring, scoringConfig, activePositions]);

  // Only the positions currently toggled on via the pills, further narrowed
  // by the name search box if there's a query typed.
  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return relevantProjections.filter((row) => {
      if (!selectedPositions.includes(row.position)) return false;
      if (query && !row.name.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [relevantProjections, selectedPositions, search]);

  // Value for whichever column is currently sorted - $/vs. market/tier read
  // through draftValueByFpid (undefined until a league's selected/loaded,
  // which compareSortValues always sorts last), pts/player/team come
  // straight off the row so they still work with no league selected.
  const renderSortableTh = (label: string, key: SortKey, miw?: number) => (
    <Table.Th
      {...(miw !== undefined ? { miw } : {})}
      onClick={() => handleSort(key)}
      style={{ cursor: "pointer" }}
    >
      <Group gap={4} wrap="nowrap">
        <Text size="sm" fw={sortKey === key ? 700 : undefined}>
          {label}
        </Text>
        {sortKey === key && <SortArrow dir={sortDir} />}
      </Group>
    </Table.Th>
  );

  // Mobile counterpart to renderSortableTh above - same click/arrow
  // behavior, styled to match this compact label strip's 10px/dimmed/
  // uppercase look instead of a real table header.
  const renderSortableLabel = (
    label: string,
    key: SortKey,
    style: CSSProperties,
  ) => {
    const isActive = sortKey === key;
    return (
      <Group
        gap={2}
        wrap="nowrap"
        onClick={() => handleSort(key)}
        style={{ cursor: "pointer", ...style }}
      >
        <Text
          size="10px"
          {...(isActive ? {} : { c: "dimmed" as const })}
          {...(isActive ? { fw: 700 } : {})}
          tt="uppercase"
        >
          {label}
        </Text>
        {isActive && <SortArrow dir={sortDir} size={10} />}
      </Group>
    );
  };

  // Global ranking across every visible position, by Rank when available
  // ($ value for auction, our own cross-position value rank for snake/
  // linear - a draft board compares players across positions directly
  // either way), falling back to raw points if no draft settings are
  // configured yet - both the default (no column clicked) and explicit
  // column sorts share the same positionRank-then-name tiebreak, so ties
  // never fall back to arbitrary array order.
  const sortedRows = useMemo(() => {
    // Value for whichever column is currently sorted - $/vs. market/tier
    // read through draftValueByFpid (undefined until a league's selected/
    // loaded, which compareSortValues always sorts last), pts/player/team
    // come straight off the row so they still work with no league selected.
    const sortValueFor = (
      row: Doc<"projections">,
      key: SortKey,
    ): number | string | undefined => {
      switch (key) {
        case "player":
          return row.name;
        case "team":
          return row.team ?? undefined;
        case "tier":
          return draftValueByFpid.get(row.fpid)?.tier;
        case "dollar":
          return isAuction
            ? draftValueByFpid.get(row.fpid)?.dollarValue
            : blendedAdpByFpid.get(row.fpid);
        case "market": {
          if (isAuction) {
            const draftValue = draftValueByFpid.get(row.fpid);
            const standardValue = standardValueByFpid.get(row.fpid);
            return draftValue && standardValue
              ? Math.round(draftValue.dollarValue) -
                  Math.round(standardValue.auctionValue)
              : undefined;
          }
          const adp = blendedAdpByFpid.get(row.fpid);
          const ourRank = ourRankByFpid.get(row.fpid);
          return adp !== undefined && ourRank !== undefined
            ? Math.round(adp) - ourRank
            : undefined;
        }
        case "pts":
          return pointsForScoringConfig(row, scoringConfig);
        case "rank":
          // Auction: same dollarValue the "$" column sorts by (there's no
          // separate "overall auction rank" number to speak of - $ itself
          // already is one). Snake/linear: our own cross-position value
          // rank (ourRankByFpid) - deliberately NOT blendedAdpByFpid (the
          // "ADP" column's own field), so Rank gives a way to sort by this
          // league's own opinion independent of the market.
          return isAuction
            ? draftValueByFpid.get(row.fpid)?.dollarValue
            : ourRankByFpid.get(row.fpid);
      }
    };

    const rows = [...visibleRows];
    // Defaults to Rank (this app's own read on "who's best" - $ for
    // auction, our cross-position value rank for snake/linear, see "rank"'s
    // own case in sortValueFor above) rather than "dollar" - user request,
    // 2026-08-30, applied the same way across every players table.
    const key: SortKey = sortKey ?? (draftValues ? "rank" : "pts");
    const dir: SortDir = sortKey ? sortDir : defaultSortDirFor(key, isAuction);
    rows.sort((a, b) => {
      const primary = compareSortValues(
        sortValueFor(a, key),
        sortValueFor(b, key),
        dir,
      );
      if (primary !== 0) return primary;
      // $ ties (every player at or below a position's replacement level
      // gets the same $1 floor - see computeDraftValuesForSettings) - and
      // any other column's own ties - fall back to position rank: a total
      // order within a position (draftValues.ts assigns strictly
      // increasing ranks even across a points tie), so this always matches
      // the positionRank badge shown rather than an external/arbitrary
      // signal. Name is the final, fully deterministic tiebreak.
      const rankDiff =
        (draftValueByFpid.get(a.fpid)?.positionRank ??
          Number.MAX_SAFE_INTEGER) -
        (draftValueByFpid.get(b.fpid)?.positionRank ?? Number.MAX_SAFE_INTEGER);
      if (rankDiff !== 0) return rankDiff;
      return a.name.localeCompare(b.name);
    });
    return rows;
  }, [
    visibleRows,
    sortKey,
    sortDir,
    draftValues,
    draftValueByFpid,
    standardValueByFpid,
    blendedAdpByFpid,
    ourRankByFpid,
    isAuction,
    scoringConfig,
  ]);

  return (
    <Stack gap="md" py="sm">
      {/* Reserves space for PositionFilterBar's fixed mobile bar below,
          which is pulled out of document flow - see
          POSITION_FILTER_BAR_HEIGHT's comment for why this is a real
          spacer element rather than a `pt` prop on this Stack (which
          already sets `py`). */}
      <Box hiddenFrom="sm" h={POSITION_FILTER_BAR_HEIGHT} />
      <Group justify="space-between" align="center" wrap="wrap">
        <Group gap="sm" wrap="wrap" align="center">
          <PositionFilterBar
            positions={activePositions}
            selected={selectedPositions}
            onChange={setSelectedPositions}
            top={MOBILE_HEADER_HEIGHT}
          />
          <TextInput
            placeholder="Search players..."
            leftSection={<Search size={16} />}
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            w={{ base: "100%", sm: 220 }}
            autoComplete="off"
          />
        </Group>
        {allProjections && (
          <Text size="xs" c="dimmed">
            Showing {relevantProjections.length} draft-relevant players.
          </Text>
        )}
        <Group gap="xs">
          {isRecalculatingValues && !isInitialValuesLoad && (
            <Loader size="xs" />
          )}
          <Text size="sm" c="dimmed">
            Scoring: {scoring}
            {selectedSettings?.teScoring &&
              selectedSettings?.teScoring !== "NONE" &&
              `, TE premium: ${selectedSettings?.teScoring}`}
          </Text>
        </Group>
      </Group>
      <AiInsightsCard
        seasonId={seasonId}
        week={week}
        scoringConfig={scoringConfig}
      />
      {draftValuesResult?.isGeneric && <GenericValuesNotice />}

      {allProjections !== undefined &&
        allRankings !== undefined &&
        !isInitialValuesLoad &&
        visibleRows.length > 0 && (
          <Box hiddenFrom="sm">
            <Text size="xs" c="dimmed">
              Swipe a row left for Target/Avoid
            </Text>
          </Box>
        )}

      <Card withBorder padding={0}>
        {allProjections === undefined ||
        allRankings === undefined ||
        isInitialValuesLoad ? (
          <Center py="xl">
            <Loader />
          </Center>
        ) : visibleRows.length === 0 ? (
          <Text c="dimmed" p="md">
            {search.trim()
              ? "No players match your search."
              : "No projections yet for the selected position(s) - fetch data first."}
          </Text>
        ) : (
          <>
            <Box visibleFrom="sm">
              <Table.ScrollContainer minWidth={640}>
                <Table striped highlightOnHover verticalSpacing={4}>
                  <Table.Thead>
                    <Table.Tr>
                      {renderSortableTh("Rank", "rank")}
                      {renderSortableTh("FPTS", "pts")}
                      {draftValues &&
                        renderSortableTh(
                          isAuction
                            ? draftValuesResult?.isGeneric
                              ? "$ (est.)"
                              : "$"
                            : "ADP",
                          "dollar",
                        )}
                      {draftValues &&
                        renderSortableTh(
                          isAuction ? "vs. market" : "vs ADP",
                          "market",
                        )}
                      {draftValues && renderSortableTh("Tier", "tier")}
                      {/* Target/avoid toggle - unlabeled icon column. */}
                      <Table.Th></Table.Th>
                      <Table.Th miw={70}>Pos</Table.Th>
                      {renderSortableTh("Player", "player", 220)}
                      {/* Tags (value-gap/consistency) - unlabeled column, same
                    placement every icon-flag table in the app uses. Keeper
                    moved into the expanded detail row (see PlayerRow.tsx). */}
                      <Table.Th></Table.Th>
                      {renderSortableTh("Team", "team")}
                      {!!selectedSettings && <Table.Th />}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {sortedRows.map((row, index) => (
                      <PlayerRow
                        key={row._id}
                        row={row}
                        index={index}
                        scoringConfig={scoringConfig}
                        injury={injuriesByFpid.get(row.fpid)}
                        isRookie={rookieFpids.has(row.fpid)}
                        draftValue={draftValueByFpid.get(row.fpid)}
                        standardValue={standardValueByFpid.get(row.fpid)}
                        isAuction={isAuction}
                        adp={blendedAdpByFpid.get(row.fpid)}
                        ourRank={ourRankByFpid.get(row.fpid)}
                        valueGap={valueGapByFpid.get(row.fpid)}
                        showValueColumn={!!draftValues}
                        tag={tagByFpid.get(row.fpid)}
                        onCycleTag={
                          seasonId
                            ? () => cyclePlayerTag({ seasonId, fpid: row.fpid })
                            : undefined
                        }
                        onSelectPlayer={setSelectedFpid}
                        consistency={
                          selectedSettings
                            ? consistencyByFpid.get(row.fpid)
                            : undefined
                        }
                        showConsistencyColumn={!!selectedSettings}
                        keeperInfo={
                          selectedSettings
                            ? keeperInfoByFpid.get(row.fpid)
                            : undefined
                        }
                        showKeeperColumn={!!selectedSettings}
                        showKeeperYear={showKeeperYear}
                        isExpanded={expandedIds.has(row._id)}
                        onToggleExpand={() => toggleExpanded(row._id)}
                      />
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Box>

            <Box hiddenFrom="sm">
              <Group
                gap={8}
                wrap="nowrap"
                px={6}
                py={4}
                style={{
                  borderBottom: "1px solid var(--mantine-color-default-border)",
                }}
              >
                {renderSortableLabel("Player", "player", { flex: 1 })}
                {!!draftValues &&
                  renderSortableLabel(isAuction ? "$" : "ADP", "dollar", {
                    width: 36,
                    flexShrink: 0,
                  })}
                {!!draftValues &&
                  renderSortableLabel(
                    isAuction ? "vs Mkt" : "vs ADP",
                    "market",
                    {
                      width: 36,
                      flexShrink: 0,
                    },
                  )}
                <Text
                  size="10px"
                  c="dimmed"
                  tt="uppercase"
                  style={{ width: 40, flexShrink: 0 }}
                >
                  Pos
                </Text>
                {renderSortableLabel("Pts", "pts", {
                  width: 34,
                  flexShrink: 0,
                  justifyContent: "flex-end",
                })}
              </Group>
              {sortedRows.map((row) => (
                <PlayerRowMobile
                  key={row._id}
                  row={row}
                  points={pointsForScoringConfig(row, scoringConfig)}
                  injury={injuriesByFpid.get(row.fpid)}
                  isRookie={rookieFpids.has(row.fpid)}
                  draftValue={draftValueByFpid.get(row.fpid)}
                  standardValue={standardValueByFpid.get(row.fpid)}
                  isAuction={isAuction}
                  adp={blendedAdpByFpid.get(row.fpid)}
                  ourRank={ourRankByFpid.get(row.fpid)}
                  valueGap={valueGapByFpid.get(row.fpid)}
                  showValueColumn={!!draftValues}
                  tag={tagByFpid.get(row.fpid)}
                  onSetTag={
                    seasonId
                      ? (tag) => {
                          setPlayerTag({ seasonId, fpid: row.fpid, tag });
                          setSwipedId(null);
                        }
                      : undefined
                  }
                  onSelectPlayer={setSelectedFpid}
                  consistency={
                    selectedSettings
                      ? consistencyByFpid.get(row.fpid)
                      : undefined
                  }
                  showConsistencyColumn={!!selectedSettings}
                  isSwiped={swipedId === row._id}
                  onSwipeOpen={() => setSwipedId(row._id)}
                  onCloseSwipe={() => setSwipedId(null)}
                />
              ))}
            </Box>
          </>
        )}
      </Card>

      <PlayerDetailModal
        fpid={selectedFpid}
        onClose={() => setSelectedFpid(null)}
        week={week}
        scoringConfig={scoringConfig}
        season={thisSeason}
        seasonId={seasonId}
      />
    </Stack>
  );
}
