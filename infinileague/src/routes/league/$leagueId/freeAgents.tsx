import { createFileRoute } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { Badge, Card, Group, Loader, Stack, Table, Text, Title } from "@mantine/core";
import { api } from "@infinidata/api";
import { positionColorOrDefault } from "@shared/positionColors";
import { RookieBadge } from "@shared/RookieBadge";
import type { FaabSuggestionsResult, StandingsRow } from "../../../types/season";

export const Route = createFileRoute("/league/$leagueId/freeAgents")({
  component: FreeAgentsPage,
});

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

  const rows = [...result.suggestions].sort(
    (a, b) => (b.suggestedBid ?? b.topDemandValue) - (a.suggestedBid ?? a.topDemandValue),
  );

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
                <Table.Th>Player</Table.Th>
                <Table.Th>Pos</Table.Th>
                <Table.Th>ROS Pts</Table.Th>
                <Table.Th>Demand</Table.Th>
                <Table.Th>Value to You</Table.Th>
                <Table.Th>Suggested Bid</Table.Th>
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
