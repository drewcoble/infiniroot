import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { Group, Stack, Text, Title } from "@mantine/core";
import type { Position } from "@shared/positionColors";
import { api } from "@infinidata/api";
import { GlassFreeAgentRow } from "../../../components/cards/GlassFreeAgentRow";
import { GlassPositionFilter } from "../../../components/cards/GlassPositionFilter";
import { GlassRosterSkeletonCard } from "../../../components/cards/GlassRosterCard";
import { GlassSegmented } from "../../../components/cards/GlassSegmented";
import classes from "../../../components/cards/GlassMatchupCard.module.css";
import { compareSortValues } from "../../../lib/tableSort";
import type {
  FaabSuggestionRow,
  FaabSuggestionsResult,
  LinkedSeason,
  RosVorRow,
  StandingsRow,
} from "../../../types/season";

export const Route = createFileRoute("/league/$leagueId/freeAgents")({
  component: FreeAgentsPage,
});

const ALL_POSITIONS: Position[] = ["QB", "RB", "WR", "TE", "DST", "K"];

// Same Week / Season views and sorts as the Players page, plus Bid (FAAB
// leagues only - the default there, Rank otherwise): "rank" = the view's
// rosVOR rank (weekRank / rosRank); "bid" = suggested bid (market value
// without one); "actual" / "projected" = this week's points / projection
// in Week view, season PPG / ROS PPG in Season view. Players with no
// rosVOR board row (or no points yet) sort last. Ties fall back to the
// rank, then name - and a Bid sort's ties to the market value first: with
// little or no FAAB left most suggested bids are $0, and market value then
// rank still order those meaningfully.
type View = "week" | "ros";
type SortKey = "rank" | "bid" | "actual" | "projected";
type SortValueKey = SortKey | "market";

const SORT_LABELS: Record<View, { actual: string; projected: string }> = {
  week: { actual: "Actual", projected: "Proj" },
  ros: { actual: "PPG", projected: "ROS PPG" },
};

// Migrated from infinidraft's src/pages/Season/FreeAgentsTab.tsx (now
// removed there) - same advisory FAAB bid calculator, backed by the same
// shared convex/lib/faab.ts computation. Rendered as glass free-agent rows
// (GlassFreeAgentRow) with the Players page's sort control and position
// filter, so the two boards read and work alike.
function FreeAgentsPage() {
  const { leagueId } = Route.useParams();
  const seasonId = leagueId as Id<"seasons">;
  const { isAuthenticated } = useConvexAuth();

  // Same standings-reuse convention as route.tsx/teams/$teamId.tsx - no
  // dedicated "self team id" query exists.
  const standings: StandingsRow[] | undefined = useQuery(
    api.infinileague.season.standings.getStandings,
    isAuthenticated ? { seasonId } : "skip",
  );
  const selfTeamId = standings?.find((row) => row.isSelf)?.teamId;

  const rookieFpids = useQuery(api.players.getRookieFpids, isAuthenticated ? {} : "skip");
  const rookieFpidSet = new Set(rookieFpids ?? []);

  const result: FaabSuggestionsResult | undefined = useQuery(
    api.infinileague.season.faabValues.getFaabSuggestions,
    isAuthenticated
      ? {
          seasonId,
          ...(selfTeamId ? { teamId: selfTeamId as Id<"seasonTeams"> } : {}),
        }
      : "skip",
  );

  // Same league-wide board the Players/Depth Charts tabs read, joined by
  // fpid for the PPG/positionRank/rosRank fields PlayerCard needs that
  // FaabSuggestionRow doesn't carry - see that query's own comment. Not
  // every free agent necessarily has a row here (faab.ts and rosVor.ts don't
  // share one hard-coded cutoff), handled per-row below.
  const rosVorRows: RosVorRow[] | undefined = useQuery(
    api.rosVor.getRosVorBoard,
    isAuthenticated && result?.week ? { seasonId, week: result.week } : "skip",
  );
  const rosVorByFpid = new Map((rosVorRows ?? []).map((row) => [row.fpid, row]));

  // Same position filter and sort control as the Players page.
  const [selectedPositions, setSelectedPositions] = useState<Position[]>([...ALL_POSITIONS]);
  const [view, setView] = useState<View>("ros");
  // Bid only means something with FAAB - a priority-waiver league hides it
  // and defaults to Rank. Unknown (seasons still loading, or not synced
  // yet) keeps the FAAB default.
  const seasonsList: LinkedSeason[] | undefined = useQuery(
    api.leagues.listLinkedSeasons,
    isAuthenticated ? {} : "skip",
  );
  const usesFaab =
    seasonsList?.find((season) => season._id === leagueId)?.waiverType !== "priority";
  // null = no manual pick yet, so the default follows the waiver type.
  const [pickedSortKey, setSortKey] = useState<SortKey | null>(null);
  const sortKey: SortKey =
    pickedSortKey === null || (pickedSortKey === "bid" && !usesFaab)
      ? usesFaab
        ? "bid"
        : "rank"
      : pickedSortKey;

  // This week's actual points (live during games) for the Week view's
  // Actual sort - same query the Players page uses.
  const weekPoints = useQuery(
    api.rosVor.getWeekPoints,
    isAuthenticated && result?.week ? { seasonId, week: result.week } : "skip",
  );
  const weekPointsByFpid = new Map((weekPoints ?? []).map((entry) => [entry.fpid, entry.points]));

  if (result === undefined) {
    return (
      <Stack gap="md">
        <Title order={3}>Free Agents</Title>
        <Stack gap={8}>
          {Array.from({ length: 8 }, (_, index) => (
            <GlassRosterSkeletonCard key={index} />
          ))}
        </Stack>
      </Stack>
    );
  }

  if (result.week === null) {
    return (
      <Stack align="center" py="xl" gap={4}>
        <Text c="dimmed">Not currently in an NFL regular season week.</Text>
        <Text c="dimmed" size="sm">
          Free agent suggestions will appear here once the season starts.
        </Text>
      </Stack>
    );
  }

  // Higher-is-better value for a sort key (rank is negated so "desc"
  // still puts #1 first).
  const sortValue = (row: FaabSuggestionRow, key: SortValueKey): number | undefined => {
    const board = rosVorByFpid.get(row.fpid);
    const isWeek = view === "week";
    if (key === "bid") return row.suggestedBid ?? row.marketValue;
    if (key === "market") return row.marketValue;
    if (key === "rank") {
      const rank = board ? (isWeek ? board.weekRank : board.rosRank) : undefined;
      return rank ? -rank : undefined;
    }
    if (key === "actual") return isWeek ? weekPointsByFpid.get(row.fpid) : board?.actualPpg;
    return isWeek ? board?.weekPpg : board?.rosPpg;
  };
  const sortChain: SortValueKey[] =
    sortKey === "bid"
      ? ["bid", "market", "rank"]
      : sortKey === "rank"
        ? ["rank"]
        : [sortKey, "rank"];
  const rows = result.suggestions
    .filter((row) => selectedPositions.includes(row.position))
    .sort((a, b) => {
      for (const key of sortChain) {
        const order = compareSortValues(sortValue(a, key), sortValue(b, key), "desc");
        if (order !== 0) return order;
      }
      return compareSortValues(a.name, b.name, "asc");
    });

  return (
    <Stack gap="md">
      <Title order={3}>Free Agents</Title>
      <GlassSegmented
        label="Ranking view"
        value={view}
        onChange={setView}
        options={[
          { label: `Week ${result.week}`, value: "week" as const },
          { label: "Season", value: "ros" as const },
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
              ...(usesFaab ? [{ label: "Bid", value: "bid" as const }] : []),
              { label: SORT_LABELS[view].actual, value: "actual" as const },
              { label: SORT_LABELS[view].projected, value: "projected" as const },
            ]}
          />
        </div>
      </Group>
      <GlassPositionFilter
        positions={ALL_POSITIONS}
        selected={selectedPositions}
        onChange={setSelectedPositions}
      />
      <Stack gap={8}>
        {rows.length === 0 && (
          <Text c="dimmed" size="sm" ta="center" py="md">
            No free agents at the selected positions.
          </Text>
        )}
        {rows.map((row, index) => {
          const rosVorRow = rosVorByFpid.get(row.fpid);
          const bidAmount = row.suggestedBid ?? row.marketValue;
          // No bid line for a player nobody's bidding on ($0/$0).
          const hasBid = bidAmount > 0 || row.marketValue > 0;
          return (
            <GlassFreeAgentRow
              key={row.fpid}
              data={{
                fpid: row.fpid,
                rank: index + 1,
                name: row.name,
                position: row.position,
                positionRank: rosVorRow?.positionRank ?? row.positionRank,
                team: row.team,
                isRookie: rookieFpidSet.has(row.fpid),
                injury: rosVorRow?.injury,
                bid: hasBid ? `$${bidAmount}` : "",
                market: hasBid ? `Mkt $${row.marketValue}` : "",
                rationale: row.rationale,
                boostReason: row.boostReason,
              }}
            />
          );
        })}
      </Stack>
    </Stack>
  );
}
