import { createFileRoute } from "@tanstack/react-router";
import type { GenericId as Id } from "convex/values";
import { Stack, Text } from "@mantine/core";
import { TeamInvitesCard } from "../../../components/TeamInvitesCard";
import { useMyViewer } from "../../../hooks/useMyViewer";

export const Route = createFileRoute("/league/$leagueId/settings")({
  component: SettingsPage,
});

// Playoff rules (everyone reads them; the commissioner edits) and, for the
// commissioner, member invites.
function SettingsPage() {
  const { leagueId } = Route.useParams();
  const seasonId = leagueId as Id<"seasons">;
  const viewer = useMyViewer(seasonId);

  return (
    <Stack gap="md">
      <Text c="dimmed">Playoff rules are coming soon.</Text>
      {viewer?.isCommissioner && <TeamInvitesCard seasonId={seasonId} />}
    </Stack>
  );
}
