import { createFileRoute } from "@tanstack/react-router";
import { Text } from "@mantine/core";

export const Route = createFileRoute("/league/$leagueId/")({
  component: PicturePage,
});

function PicturePage() {
  return <Text c="dimmed">Picture is coming soon.</Text>;
}
