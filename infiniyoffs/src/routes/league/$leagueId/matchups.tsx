import { createFileRoute } from "@tanstack/react-router";
import { Text } from "@mantine/core";

export const Route = createFileRoute("/league/$leagueId/matchups")({
  component: MatchupsPage,
});

function MatchupsPage() {
  return <Text c="dimmed">Matchups is coming soon.</Text>;
}
