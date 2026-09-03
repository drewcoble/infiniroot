import { createFileRoute } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { Group, Loader, Stack, Text, Title } from "@mantine/core";
import { api } from "@infinidata/api";
import { PlayerCard } from "../../../components/PlayerCard";
import { compareSortValues } from "../../../lib/tableSort";
import type { FaabSuggestionRow, FaabSuggestionsResult, RosVorRow, StandingsRow } from "../../../types/season";

export const Route = createFileRoute("/league/$leagueId/freeAgents")({
  component: FreeAgentsPage,
});

function sortValueFor(row: FaabSuggestionRow): number | undefined {
  return row.suggestedBid ?? undefined;
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

  const rookieFpids = useQuery(
    api.players.getRookieFpids,
    isAuthenticated ? {} : "skip",
  );
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
    return <Loader />;
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
      <Group justify="space-between" wrap="wrap">
        <Title order={3}>Free Agents — Week {result.week}</Title>
        <Text c="dimmed" size="sm">
          {result.remainingWeeks} weeks remaining this season
        </Text>
      </Group>
      <Stack gap={8}>
        {rows.map((row) => {
          const bidFooter = (
            <Group gap={8} wrap="nowrap">
              <Text size="sm" fw={700}>
                {row.suggestedBid !== null ? `$${row.suggestedBid}` : "—"}
              </Text>
              <Text size="xs" c="dimmed" truncate style={{ flex: 1 }}>
                {row.rationale ?? "No suggestion available"}
              </Text>
            </Group>
          );

          const rosVorRow = rosVorByFpid.get(row.fpid);
          if (rosVorRow) {
            return (
              <PlayerCard
                key={row.fpid}
                row={rosVorRow}
                isRookie={rookieFpidSet.has(row.fpid)}
                footer={bidFooter}
              />
            );
          }

          // No rosVOR row for this fpid - a minimal stand-in RosVorRow
          // (PPG/rank fields zeroed) rather than a second bespoke card
          // layout, so the bid footer still renders through the same
          // component. positionRank comes from FaabSuggestionRow itself
          // (faab.ts computes its own), so that badge still reads real.
          return (
            <PlayerCard
              key={row.fpid}
              row={{
                fpid: row.fpid,
                name: row.name,
                team: row.team,
                position: row.position,
                rosVor: row.rosValue,
                rosRank: 0,
                actualVor: 0,
                actualRank: 0,
                positionRank: row.positionRank,
                rosPpg: 0,
                actualPpg: 0,
                rosteredByTeamName: null,
              }}
              isRookie={rookieFpidSet.has(row.fpid)}
              leftLabel="—"
              footer={bidFooter}
            />
          );
        })}
      </Stack>
    </Stack>
  );
}
