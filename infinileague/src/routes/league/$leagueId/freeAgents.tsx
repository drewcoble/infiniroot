import { createFileRoute } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { Stack, Text, Title } from "@mantine/core";
import { api } from "@infinidata/api";
import { GlassFreeAgentRow } from "../../../components/cards/GlassFreeAgentRow";
import { GlassRosterSkeletonCard } from "../../../components/cards/GlassRosterCard";
import classes from "../../../components/cards/GlassMatchupCard.module.css";
import { compareSortValues } from "../../../lib/tableSort";
import type {
  FaabSuggestionRow,
  FaabSuggestionsResult,
  RosVorRow,
  StandingsRow,
} from "../../../types/season";

export const Route = createFileRoute("/league/$leagueId/freeAgents")({
  component: FreeAgentsPage,
});

function sortValueFor(row: FaabSuggestionRow): number | undefined {
  return row.suggestedBid ?? row.marketValue;
}

// Migrated from infinidraft's src/pages/Season/FreeAgentsTab.tsx (now
// removed there) - same advisory FAAB bid calculator, backed by the same
// shared convex/lib/faab.ts computation. Re-shelled from a sortable table
// into the same PlayerCard the Players/Depth Charts tabs use (with an added
// bid/rationale footer row) rather than its own bespoke row layout, so a
// player reads identically everywhere in the app.
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

  // Highest suggested bid first - the single number most directly answers
  // "who should I actually bid on" - tiebroken by valueOverReplacement, the
  // same VOR the pre-draft value process ranks by (convex/draftValues.ts),
  // then name for full determinism.
  const rows = [...result.suggestions].sort((a, b) => {
    const primary = compareSortValues(sortValueFor(a), sortValueFor(b), "desc");
    if (primary !== 0) return primary;
    const secondary = compareSortValues(a.valueOverReplacement, b.valueOverReplacement, "desc");
    if (secondary !== 0) return secondary;
    return compareSortValues(a.name, b.name, "asc");
  });

  return (
    <Stack gap="md">
      {/* Same title + quiet status line as the league home. */}
      <div>
        <Title order={3}>Free Agents</Title>
        <div className={classes.pageHeaderStatus}>
          Week {result.week} · {result.remainingWeeks} weeks remaining
        </div>
      </div>
      <Stack gap={8}>
        {rows.map((row, index) => {
          const rosVorRow = rosVorByFpid.get(row.fpid);
          const bidAmount = row.suggestedBid ?? row.marketValue;
          // No bid line for a player nobody's bidding on ($0/$0).
          const hasBid = bidAmount > 0 || row.marketValue > 0;
          return (
            <GlassFreeAgentRow
              key={row.fpid}
              data={{
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
                stats: [
                  {
                    label: "Your bid",
                    value: row.suggestedBid !== null ? `$${row.suggestedBid}` : "—",
                  },
                  { label: "Market", value: `$${row.marketValue}` },
                  { label: "Your value", value: row.myValue !== null ? `$${row.myValue}` : "—" },
                  { label: "Teams in need", value: String(row.demandCount) },
                  { label: "VOR", value: row.valueOverReplacement.toFixed(1) },
                  {
                    label: "ROS PPG",
                    value: rosVorRow ? rosVorRow.rosPpg.toFixed(1) : "—",
                  },
                ],
              }}
            />
          );
        })}
      </Stack>
    </Stack>
  );
}
