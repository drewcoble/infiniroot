import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { Badge, Card, Group, Loader, Stack, Table, Text, Title } from "@mantine/core";
import { api } from "@infinidata/api";
import { positionColorOrDefault } from "@shared/positionColors";
import { RookieBadge } from "@shared/RookieBadge";
import { SortArrow } from "../../../components/SortArrow";
import { compareSortValues, type SortDir } from "../../../lib/tableSort";
import type { FaabSuggestionRow, FaabSuggestionsResult, StandingsRow } from "../../../types/season";

export const Route = createFileRoute("/league/$leagueId/freeAgents")({
  component: FreeAgentsPage,
});

type SortKey = "player" | "position" | "rosValue" | "vor" | "demand" | "myValue" | "suggestedBid";

// Suggested Bid/Value to You default to descending (highest first); Player/
// Pos default A-Z. Applied when a header's clicked for the first time -
// clicking the same header again just flips direction (see handleSort).
const DEFAULT_SORT_DIR: Record<SortKey, SortDir> = {
  player: "asc",
  position: "asc",
  rosValue: "desc",
  vor: "desc",
  demand: "desc",
  myValue: "desc",
  suggestedBid: "desc",
};

function sortValueFor(row: FaabSuggestionRow, key: SortKey): number | string | undefined {
  switch (key) {
    case "player":
      return row.name;
    case "position":
      return row.position;
    case "rosValue":
      return row.rosValue;
    case "vor":
      return row.valueOverReplacement;
    case "demand":
      return row.demandCount;
    case "myValue":
      return row.myValue ?? undefined;
    case "suggestedBid":
      return row.suggestedBid ?? undefined;
  }
}

// Migrated from infinidraft's src/pages/Season/FreeAgentsTab.tsx (now
// removed there) - same advisory FAAB bid calculator, backed by the same
// shared convex/lib/faab.ts computation, just infinileague's own thinner UI
// (no PositionFilterBar/PlayerDetailModal - those are draft-specific
// components that don't exist here).
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

  // null until a column header's clicked - the table keeps its default
  // suggested-bid-first order (see sortedRows below) until then.
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(DEFAULT_SORT_DIR[key]);
    }
  };

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

  // Defaults to Suggested Bid (highest first) - the single number most
  // directly answers "who should I actually bid on" - tiebroken by
  // valueOverReplacement, the same VOR the pre-draft value process ranks by
  // (convex/draftValues.ts), not the demand-based fields (those are
  // per-team and situational, a worse tiebreak than a stable value
  // ranking) - then name for full determinism. A clicked column uses the
  // same tiebreak chain, not just raw array order.
  const key: SortKey = sortKey ?? "suggestedBid";
  const dir: SortDir = sortKey ? sortDir : "desc";
  const rows = [...result.suggestions].sort((a, b) => {
    const primary = compareSortValues(sortValueFor(a, key), sortValueFor(b, key), dir);
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
      <Card withBorder padding="md">
        <Table.ScrollContainer minWidth={640}>
          <Table highlightOnHover verticalSpacing={4}>
            <Table.Thead>
              <Table.Tr>
                {renderSortableTh("Player", "player")}
                {renderSortableTh("Pos", "position")}
                {renderSortableTh("ROS Pts", "rosValue")}
                {renderSortableTh("VOR", "vor")}
                {renderSortableTh("Demand", "demand")}
                {renderSortableTh("Value to You", "myValue")}
                {renderSortableTh("Suggested Bid", "suggestedBid")}
                <Table.Th>Why</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((row) => (
                <Table.Tr key={row.fpid}>
                  <Table.Td>
                    <Group gap={6} wrap="nowrap">
                      <Text size="sm" fw={500}>
                        {row.name}
                      </Text>
                      {rookieFpidSet.has(row.fpid) && <RookieBadge />}
                      {row.team && (
                        <Text c="dimmed" size="sm">
                          {row.team}
                        </Text>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Badge size="sm" color={positionColorOrDefault(row.position)} variant="light">
                      {row.position}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{row.rosValue.toFixed(1)}</Table.Td>
                  <Table.Td>{row.valueOverReplacement.toFixed(1)}</Table.Td>
                  <Table.Td>
                    {row.demandCount > 0 ? (
                      <Text size="sm">
                        {row.demandCount} team{row.demandCount === 1 ? "" : "s"}
                      </Text>
                    ) : (
                      <Text size="sm" c="dimmed">
                        None
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>{row.myValue !== null ? `$${row.myValue.toFixed(0)}` : "—"}</Table.Td>
                  <Table.Td fw={700}>
                    {row.suggestedBid !== null ? `$${row.suggestedBid}` : "—"}
                  </Table.Td>
                  <Table.Td>
                    <Text c="dimmed" size="sm">
                      {row.rationale ?? "—"}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>
    </Stack>
  );
}
