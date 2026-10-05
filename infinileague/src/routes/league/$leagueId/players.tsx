import { useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { Box, Group, Loader, SegmentedControl, Stack, Text, Title } from "@mantine/core";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { api } from "@infinidata/api";
import { PositionFilterBar } from "@shared/PositionFilterBar";
import { MOBILE_HEADER_HEIGHT, POSITION_FILTER_BAR_HEIGHT } from "@shared/constants";
import type { Position } from "@shared/positionColors";
import { PlayerCard } from "@shared/PlayerCard";
import type { RosVorRow } from "../../../types/season";

export const Route = createFileRoute("/league/$leagueId/players")({
  component: PlayersPage,
});

interface NflState {
  season: string;
  week: string;
  seasonType: "pre" | "regular" | "post";
}

const ALL_POSITIONS: Position[] = ["QB", "RB", "WR", "TE", "DST", "K"];

// Card height (~62px for the 2-row layout, measured live) + the gap below
// it (8px) - has to match PlayerCard's actual rendered height for the
// virtualizer's offsets to line up; there's no ResizeObserver measuring it
// live since every card is the same fixed shape (see PlayerCard's own
// comment).
const PLAYER_CARD_HEIGHT = 71;

// "rank" is each view's own VOR ranking (weekRank/rosRank) - the default.
// "actual"/"projected" map to a different raw stat per view (see
// SORT_FIELDS), so a choice carries over sensibly when switching views.
type SortKey = "rank" | "actual" | "projected";
type SortField = "weekPoints" | "weekPpg" | "actualPpg" | "rosPpg";

const SORT_FIELDS: Record<"week" | "ros", Record<Exclude<SortKey, "rank">, SortField>> = {
  week: { actual: "weekPoints", projected: "weekPpg" },
  ros: { actual: "actualPpg", projected: "rosPpg" },
};

const SORT_LABELS: Record<"week" | "ros", Record<Exclude<SortKey, "rank">, string>> = {
  week: { actual: "Actual", projected: "Proj" },
  ros: { actual: "PPG", projected: "ROS PPG" },
};

// Same formatting as My Team's weekly Proj/Actual (TeamRosterList.tsx).
function formatPoints(points: number | undefined): string {
  return points === undefined ? "—" : points.toFixed(2);
}

// Overall + positional ranks for a stat sort, so the left label and the
// position badge ("RB12") always describe the order the list is actually
// in - the backend's rosRank/positionRank are rosVOR ranks and would read
// out of order once the list is sorted by something else. Computed over
// the full board (not the position-filtered subset), matching how the
// backend's own ranks are global. Ties break on the view's own rank so the
// order is stable; a player with no weekPoints yet (game not played) sorts
// as 0.
function rankByMetric(
  rows: RosVorRow[],
  field: SortField,
  tieBreak: (row: RosVorRow) => number,
): Map<number, { overall: number; position: number }> {
  const sorted = [...rows].sort(
    (a, b) => (b[field] ?? 0) - (a[field] ?? 0) || tieBreak(a) - tieBreak(b),
  );
  const positionCounts = new Map<RosVorRow["position"], number>();
  const ranks = new Map<number, { overall: number; position: number }>();
  sorted.forEach((row, index) => {
    const position = (positionCounts.get(row.position) ?? 0) + 1;
    positionCounts.set(row.position, position);
    ranks.set(row.fpid, { overall: index + 1, position });
  });
  return ranks;
}

// Every rosterable player in the league (rostered or free agent), ranked by
// rosVOR - the full board convex/rosVor.ts computes, not just the free
// agents the Free Agents tab shows. Windowed against the page's own scroll
// (useWindowVirtualizer) rather than a nested scrolling box, matching how
// every other infinileague page scrolls - only cards actually in the
// viewport are ever mounted, so this stays smooth even at 800+ players.
function PlayersPage() {
  const { leagueId } = Route.useParams();
  const seasonId = leagueId as Id<"seasons">;
  const { isAuthenticated } = useConvexAuth();

  const nflState: NflState | null | undefined = useQuery(
    api.nflState.getNflState,
    isAuthenticated ? {} : "skip",
  );

  const rookieFpids = useQuery(
    api.players.getRookieFpids,
    isAuthenticated ? {} : "skip",
  );
  const rookieFpidSet = new Set(rookieFpids ?? []);

  // Own-roster highlight - see PlayerCard's isOnMyTeam handling. Same
  // getStandings->isSelf pattern route.tsx/freeAgents.tsx/trade.tsx already
  // use to find "my team" in this league.
  const standings = useQuery(
    api.infinileague.season.standings.getStandings,
    isAuthenticated ? { seasonId } : "skip",
  );
  const selfTeamId = standings?.find((row) => row.isSelf)?.teamId;

  const boardRows: RosVorRow[] | undefined = useQuery(
    api.rosVor.getRosVorBoard,
    isAuthenticated && nflState
      ? {
          seasonId,
          week: nflState.week,
          ...(selfTeamId ? { teamId: selfTeamId as Id<"seasonTeams"> } : {}),
        }
      : "skip",
  );

  // This week's actual points, live during games (see convex/rosVor.ts's
  // getWeekPoints) - its own query rather than a board field so live
  // updates only re-run this small query, not the whole board. Fetched in
  // both views so switching to This Week doesn't flash empty.
  const weekPoints = useQuery(
    api.rosVor.getWeekPoints,
    isAuthenticated && nflState ? { seasonId, week: nflState.week } : "skip",
  );
  const rows = useMemo(() => {
    if (!boardRows) return undefined;
    const pointsByFpid = new Map((weekPoints ?? []).map((entry) => [entry.fpid, entry.points]));
    return boardRows.map((row) => {
      const points = pointsByFpid.get(row.fpid);
      return points === undefined ? row : { ...row, weekPoints: points };
    });
  }, [boardRows, weekPoints]);

  const [selectedPositions, setSelectedPositions] = useState<Position[]>([...ALL_POSITIONS]);
  // Defaults to "ros" - matches the board's own default sort
  // (getRosVorBoard orders by rosRank) so switching to this tab shows the
  // same ranking it always has unless the viewer opts into "This Week."
  const [metric, setMetric] = useState<"week" | "ros">("ros");
  const isWeekMode = metric === "week";
  const [sortKey, setSortKey] = useState<SortKey>("rank");

  // Memoized since the window virtualizer re-renders this component on
  // every scroll frame - no need to re-rank 800+ players each time.
  const metricRanks = useMemo(() => {
    if (!rows || sortKey === "rank") return null;
    return rankByMetric(rows, SORT_FIELDS[metric][sortKey], (row) =>
      isWeekMode ? row.weekRank : row.rosRank,
    );
  }, [rows, sortKey, metric, isWeekMode]);

  const filteredRows = (rows ?? [])
    .filter((row) => selectedPositions.includes(row.position))
    .sort((a, b) => {
      if (metricRanks) {
        return (metricRanks.get(a.fpid)?.overall ?? 0) - (metricRanks.get(b.fpid)?.overall ?? 0);
      }
      return isWeekMode ? a.weekRank - b.weekRank : a.rosRank - b.rosRank;
    });

  const listRef = useRef<HTMLDivElement>(null);
  const virtualizer = useWindowVirtualizer({
    count: filteredRows.length,
    estimateSize: () => PLAYER_CARD_HEIGHT,
    overscan: 10,
    scrollMargin: listRef.current?.offsetTop ?? 0,
  });

  if (nflState === undefined || rows === undefined) {
    return <Loader />;
  }

  if (nflState === null || nflState.seasonType !== "regular") {
    return (
      <Stack align="center" py="xl" gap={4}>
        <Text c="dimmed">Not currently in an NFL regular season week.</Text>
        <Text c="dimmed" size="sm">
          Player rankings will appear here once the season starts.
        </Text>
      </Stack>
    );
  }

  // getRosVorBoard only ever reads the cache convex/rosVor.ts's daily cron
  // writes - unlike FAAB, it has no live-compute fallback (recomputing the
  // full league-wide board on every reactive query re-run would be far more
  // expensive than FAAB's one-shot fallback). An empty board here almost
  // always means the cron hasn't run for this league/week yet, not that
  // there are genuinely zero players - worth saying so explicitly rather
  // than silently rendering an empty list.
  if (rows.length === 0) {
    return (
      <Stack align="center" py="xl" gap={4}>
        <Text c="dimmed">Player rankings haven&apos;t been computed for this week yet.</Text>
        <Text c="dimmed" size="sm">
          Check back after the next daily refresh.
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      {/* Reserves space for PositionFilterBar's fixed mobile bar below,
          which is pulled out of document flow - see
          POSITION_FILTER_BAR_HEIGHT's comment for why this is a real
          spacer element rather than a `pt` prop on this Stack. */}
      <Box hiddenFrom="sm" h={POSITION_FILTER_BAR_HEIGHT} />
      <Title order={3}>Players — {isWeekMode ? `Week ${nflState.week}` : "Rest of Season"}</Title>
      <SegmentedControl
        value={metric}
        onChange={(value) => setMetric(value as "week" | "ros")}
        data={[
          { label: "This Week", value: "week" },
          { label: "Rest of Season", value: "ros" },
        ]}
      />
      <Group gap="sm" wrap="nowrap">
        <Text size="sm" c="dimmed">
          Sort by
        </Text>
        <SegmentedControl
          size="xs"
          style={{ flex: 1 }}
          value={sortKey}
          onChange={(value) => setSortKey(value as SortKey)}
          data={[
            { label: "Rank", value: "rank" },
            { label: SORT_LABELS[metric].actual, value: "actual" },
            { label: SORT_LABELS[metric].projected, value: "projected" },
          ]}
        />
      </Group>
      <PositionFilterBar
        positions={ALL_POSITIONS}
        selected={selectedPositions}
        onChange={setSelectedPositions}
        top={MOBILE_HEADER_HEIGHT}
      />
      <div ref={listRef} style={{ position: "relative", height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = filteredRows[item.index];
          if (!row) return null;
          const sortRank = metricRanks?.get(row.fpid);
          const leftLabel = sortRank
            ? String(sortRank.overall)
            : isWeekMode
              ? String(row.weekRank)
              : undefined;
          const positionRank = sortRank
            ? sortRank.position
            : isWeekMode
              ? row.weekPositionRank
              : row.positionRank;
          return (
            <div
              key={row.fpid}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                paddingBottom: 8,
                transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`,
              }}
            >
              <PlayerCard
                row={{ ...row, positionRank }}
                isRookie={rookieFpidSet.has(row.fpid)}
                {...(leftLabel ? { leftLabel } : {})}
                {...(isWeekMode
                  ? {
                      // This week's own numbers rather than the default
                      // season-long PPG/ROS PPG stack - same Proj-over-
                      // Actual layout as My Team (TeamRosterList.tsx).
                      rightStats: (
                        <>
                          <Text size="xs" c="dimmed">
                            {formatPoints(row.weekPpg)} Proj
                          </Text>
                          <Text size="xs" c="dimmed">
                            {formatPoints(row.weekPoints)} Actual
                          </Text>
                        </>
                      ),
                    }
                  : {})}
              />
            </div>
          );
        })}
      </div>
    </Stack>
  );
}
