import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Stack } from "@mantine/core";
import { AppHeader } from "../components/AppHeader";
import { PageContainer } from "@shared/PageContainer";
import { ConnectSleeperLeague } from "@shared/ConnectSleeperLeague";

export const Route = createFileRoute("/connect-sleeper")({
  component: ConnectSleeperPage,
});

// A league connected here is an ordinary createLeague/initializeSeasonTeams
// season row - infinidraft and infinileague pick it up automatically, since
// it's the same leagues/seasons tables (see ConnectSleeperLeague's own
// comment for the exact mutations this calls).
function ConnectSleeperPage() {
  const navigate = useNavigate();

  return (
    <PageContainer>
      <Stack gap="lg">
        <AppHeader />
        <ConnectSleeperLeague
          onConnected={(seasonId) =>
            void navigate({ to: "/league/$leagueId", params: { leagueId: seasonId } })
          }
          onCancel={() => void navigate({ to: "/" })}
        />
      </Stack>
    </PageContainer>
  );
}
