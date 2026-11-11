import { createFileRoute } from "@tanstack/react-router";
import { Text } from "@mantine/core";

export const Route = createFileRoute("/league/$leagueId/bracket")({
  component: BracketPage,
});

function BracketPage() {
  return <Text c="dimmed">Bracket is coming soon.</Text>;
}
