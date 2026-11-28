import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { api } from "@infinidata/api";
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
// seasons tables) - see @shared/AddLeague for the provider wizards. It
// goes on infiniyoffs straight away and opens on its settings.
function AddLeaguePage() {
  const navigate = useNavigate();
  const setInYoffs = useMutation(api.infiniyoffs.leagues.setInYoffs);
  const { provider } = Route.useSearch();

  return (
    <PageContainer>
      <Stack gap="lg">
        <AppHeader />
        <AddLeague
          app="infiniyoffs"
          initialProvider={provider}
          onConnected={(seasonId) =>
            void (async () => {
              await setInYoffs({ seasonId: seasonId as Id<"seasons">, inYoffs: true });
              await navigate({ to: "/league/$leagueId/settings", params: { leagueId: seasonId } });
            })()
          }
          onCancel={() => void navigate({ to: "/" })}
        />
      </Stack>
    </PageContainer>
  );
}
