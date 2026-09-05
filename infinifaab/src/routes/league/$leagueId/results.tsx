import { createFileRoute } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { Card, Center, Group, Loader, Stack, Text, Title } from "@mantine/core";
import { api } from "@infinidata/api";
import type { AuctionResultRow } from "../../../types/season";

export const Route = createFileRoute("/league/$leagueId/results")({
  component: ResultsTab,
});

function ResultsTab() {
  const { leagueId } = Route.useParams();
  const seasonId = leagueId as Id<"seasons">;
  const { isAuthenticated } = useConvexAuth();

  const results: AuctionResultRow[] | undefined = useQuery(
    api.infinileague.auction.cycles.listResults,
    isAuthenticated ? { seasonId } : "skip",
  );

  if (results === undefined) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }

  if (results.length === 0) {
    return (
      <Stack gap="xs" py="xl" align="center">
        <Text c="dimmed">No auctions have closed yet.</Text>
      </Stack>
    );
  }

  const cycles = new Map<string, { closesAt: number; rows: AuctionResultRow[] }>();
  for (const row of results) {
    const entry = cycles.get(row.cycleId) ?? { closesAt: row.closesAt, rows: [] };
    entry.rows.push(row);
    cycles.set(row.cycleId, entry);
  }

  return (
    <Stack gap="lg">
      {[...cycles.entries()].map(([cycleId, { closesAt, rows }]) => (
        <Stack key={cycleId} gap={8}>
          <Title order={5}>{new Date(closesAt).toLocaleDateString()}</Title>
          {rows.map((row) => (
            <Card key={`${cycleId}-${row.fpid}`} withBorder padding="xs" radius="md">
              <Group justify="space-between" wrap="nowrap">
                <Text size="sm" fw={500} truncate style={{ flex: 1 }}>
                  {row.playerName ?? `Player #${row.fpid}`}
                </Text>
                {row.winnerTeamName ? (
                  <>
                    <Text size="sm" c="dimmed" truncate>
                      {row.winnerTeamName}
                    </Text>
                    <Text size="sm" fw={700}>
                      ${row.price}
                    </Text>
                  </>
                ) : (
                  <Text size="sm" c="dimmed">
                    No winner - cleared waivers before close
                  </Text>
                )}
              </Group>
            </Card>
          ))}
        </Stack>
      ))}
    </Stack>
  );
}
