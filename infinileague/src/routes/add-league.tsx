import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Stack } from "@mantine/core";
import { AppHeader } from "../components/AppHeader";
import { PageContainer } from "@shared/PageContainer";
import { AddLeague, type LeagueProvider } from "@shared/AddLeague";

interface AddLeagueSearch {
  provider?: LeagueProvider;
}

// ?provider= opens that provider's wizard directly (the Yahoo reconnect link
// uses it); anything else shows the provider choice.
export const Route = createFileRoute("/add-league")({
  validateSearch: (search: Record<string, unknown>): AddLeagueSearch =>
    search.provider === "sleeper" || search.provider === "yahoo" || search.provider === "espn"
      ? { provider: search.provider }
      : {},
  component: AddLeaguePage,
});

// A league connected here is an ordinary createLeague/initializeSeasonTeams
// season row, so the other apps pick it up automatically (same leagues/
// seasons tables) - see @shared/AddLeague for the provider wizards.
function AddLeaguePage() {
  const navigate = useNavigate();
  const { provider } = Route.useSearch();

  return (
    <PageContainer>
      <Stack gap="lg">
        <AppHeader />
        <AddLeague
          app="infinileague"
          initialProvider={provider}
          onConnected={(seasonId) =>
            void navigate({ to: "/league/$leagueId", params: { leagueId: seasonId } })
          }
          onCancel={() => void navigate({ to: "/" })}
        />
      </Stack>
    </PageContainer>
  );
}
