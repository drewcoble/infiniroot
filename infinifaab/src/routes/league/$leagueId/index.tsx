import { createFileRoute } from "@tanstack/react-router";
import type { GenericId as Id } from "convex/values";
import { Badge, Card, Center, Group, Loader, Stack, Text } from "@mantine/core";
import { useAuctionDashboard } from "@shared-core/useAuctionDashboard";

export const Route = createFileRoute("/league/$leagueId/")({
  component: DashboardTab,
});

// Card layout matches the rest of the app's list style (PlayerCard/
// TeamCard's "left label, flexible middle, stat stack right" shape),
// simplified to just the three fields asked for. Data fetching lives in
// shared-core's useAuctionDashboard, not here - see MOBILE_SPLIT_PLAN.md /
// INFINIFAAB_MOBILE_PLAN.md for why (shared between the web and future
// native FAAB apps).
function DashboardTab() {
  const { leagueId } = Route.useParams();
  const seasonId = leagueId as Id<"seasons">;

  const rows = useAuctionDashboard(seasonId);

  if (rows === undefined) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }

  if (rows.length === 0) {
    return (
      <Stack gap="xs" py="xl" align="center">
        <Text c="dimmed">No teams found for this league yet.</Text>
      </Stack>
    );
  }

  return (
    <Stack gap={8}>
      {rows.map((row, index) => (
        <Card key={row.teamId} withBorder padding="xs" radius="md">
          <Group wrap="nowrap" gap="sm">
            <Text size="sm" fw={700} c="dimmed" w={28} ta="right">
              {index + 1}
            </Text>
            <Text size="sm" fw={500} style={{ flex: 1 }} truncate>
              {row.teamName}
            </Text>
            {row.activeWinningBids > 0 && (
              <Badge size="sm" variant="light" color="green">
                Winning {row.activeWinningBids}
              </Badge>
            )}
            <Text size="sm" fw={700} w={70} ta="right">
              ${row.faabRemaining}
            </Text>
          </Group>
        </Card>
      ))}
    </Stack>
  );
}
