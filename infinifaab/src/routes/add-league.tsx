import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Stack } from "@mantine/core";
import { AppHeader } from "../components/AppHeader";
import { PageContainer } from "@shared/PageContainer";
import { AddLeague } from "@shared/AddLeague";

export const Route = createFileRoute("/add-league")({
  component: AddLeaguePage,
});

// A league connected here is an ordinary createLeague/initializeSeasonTeams
// season row, so the other apps pick it up automatically (same leagues/
// seasons tables) - see @shared/AddLeague for the provider wizards.
function AddLeaguePage() {
  const navigate = useNavigate();

  return (
    <PageContainer>
      <Stack gap="lg">
        <AppHeader />
        <AddLeague
          app="infinifaab"
          onConnected={(seasonId) =>
            void navigate({ to: "/league/$leagueId", params: { leagueId: seasonId } })
          }
          onCancel={() => void navigate({ to: "/" })}
        />
      </Stack>
    </PageContainer>
  );
}
