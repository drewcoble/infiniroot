import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { api } from "@infinidata/api";
import { getErrorMessage } from "@shared/errors";
import { useState } from "react";
import { Alert, Button, Stack } from "@mantine/core";
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
// goes on infiniyoffs straight away and opens the setup flow - unless it
// can't (a guillotine league), which says so instead. It stays connected
// for the other apps either way.
function AddLeaguePage() {
  const navigate = useNavigate();
  const setInYoffs = useMutation(api.infiniyoffs.leagues.setInYoffs);
  const { provider } = Route.useSearch();
  const [refused, setRefused] = useState<string | null>(null);

  return (
    <PageContainer>
      <Stack gap="lg">
        <AppHeader />
        {refused ? (
          <Stack gap="md" maw={420} mx="auto">
            <Alert color="yellow" title="Can't use this league on yoffs">
              {refused}
            </Alert>
            <Button variant="default" onClick={() => void navigate({ to: "/" })}>
              Back to leagues
            </Button>
          </Stack>
        ) : (
          <AddLeague
            app="infiniyoffs"
            initialProvider={provider}
            onConnected={(seasonId) =>
              void (async () => {
                try {
                  await setInYoffs({ seasonId: seasonId as Id<"seasons">, inYoffs: true });
                } catch (err) {
                  setRefused(getErrorMessage(err, "This league can't go on yoffs."));
                  return;
                }
                await navigate({
                  to: "/league/$leagueId/setup",
                  params: { leagueId: seasonId },
                });
              })()
            }
            onCancel={() => void navigate({ to: "/" })}
          />
        )}
      </Stack>
    </PageContainer>
  );
}
