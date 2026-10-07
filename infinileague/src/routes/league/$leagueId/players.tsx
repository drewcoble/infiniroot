import { useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { Group, Stack, Text, Title } from "@mantine/core";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { api } from "@infinidata/api";
import type { Position } from "@shared/positionColors";
import { GlassPlayerRow } from "../../../components/cards/GlassPlayerRow";
import { GlassPositionFilter } from "../../../components/cards/GlassPositionFilter";
import { GlassRosterSkeletonCard } from "../../../components/cards/GlassRosterCard";
import { GlassSegmented } from "../../../components/cards/GlassSegmented";
import classes from "../../../components/cards/GlassMatchupCard.module.css";
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

// Starting estimate for a glass player row (~64px) + the gap below it
// (8px) - the virtualizer then measures each rendered row (measureElement),
// so a long name or larger text size never knocks the offsets out of line.
const PLAYER_ROW_ESTIMATE = 72;

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

// Overall + positional ranks for a stat sort, so the rank chip and the
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

  // Own-roster highlight (GlassPlayerRow's saddlebrown rank chip). Same
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
    estimateSize: () => PLAYER_ROW_ESTIMATE,
    overscan: 10,
    scrollMargin: listRef.current?.offsetTop ?? 0,
  });

  if (nflState === undefined || rows === undefined) {
    return (
      <Stack gap="md">
        <Title order={3}>Players</Title>
        <span className={classes.skeletonBar} style={{ height: 42 }} />
        <Stack gap={8}>
          {Array.from({ length: 8 }, (_, index) => (
            <GlassRosterSkeletonCard key={index} />
          ))}
        </Stack>
      </Stack>
    );
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
      <Title order={3}>Players</Title>
      <GlassSegmented
        label="Ranking view"
        value={metric}
        onChange={setMetric}
        options={[
          { label: `Week ${nflState.week}`, value: "week" as const },
          { label: "Rest of Season", value: "ros" as const },
        ]}
      />
      <Group gap="sm" wrap="nowrap">
        <span className={classes.strengthLabel}>Sort</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <GlassSegmented
            compact
            label="Sort by"
            value={sortKey}
            onChange={setSortKey}
            options={[
              { label: "Rank", value: "rank" as const },
              { label: SORT_LABELS[metric].actual, value: "actual" as const },
              { label: SORT_LABELS[metric].projected, value: "projected" as const },
            ]}
          />
        </div>
      </Group>
      <GlassPositionFilter
        positions={ALL_POSITIONS}
        selected={selectedPositions}
        onChange={setSelectedPositions}
      />
      <div ref={listRef} style={{ position: "relative", height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = filteredRows[item.index];
          if (!row) return null;
          const sortRank = metricRanks?.get(row.fpid);
          const rank = sortRank
            ? sortRank.overall
            : isWeekMode
              ? row.weekRank
              : row.rosRank;
          const positionRank = sortRank
            ? sortRank.position
            : isWeekMode
              ? row.weekPositionRank
              : row.positionRank;
          return (
            <div
              key={row.fpid}
              data-index={item.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                paddingBottom: 8,
                transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`,
              }}
            >
              {/* Big = what's happened (this week's points / season PPG),
                  small = the projection - same split as the other glass
                  cards. Nothing big for a week they haven't played yet. */}
              <GlassPlayerRow
                data={{
                  rank,
                  name: row.name,
                  position: row.position,
                  positionRank,
                  team: row.team,
                  rosteredByTeamName: row.rosteredByTeamName,
                  isOnMyTeam: row.isOnMyTeam === true,
                  isRookie: rookieFpidSet.has(row.fpid),
                  injury: row.injury,
                  actual: isWeekMode
                    ? row.weekPoints !== undefined
                      ? row.weekPoints.toFixed(2)
                      : ""
                    : row.actualPpg.toFixed(1),
                  projection: isWeekMode
                    ? `Proj ${row.weekPpg.toFixed(1)}`
                    : `ROS ${row.rosPpg.toFixed(1)}`,
                }}
              />
            </div>
          );
        })}
      </div>
    </Stack>
  );
}
