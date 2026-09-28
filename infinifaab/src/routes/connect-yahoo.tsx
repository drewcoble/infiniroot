import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Stack } from "@mantine/core";
import { AppHeader } from "../components/AppHeader";
import { PageContainer } from "@shared/PageContainer";
import { ConnectYahooLeague } from "@shared/ConnectYahooLeague";

export const Route = createFileRoute("/connect-yahoo")({
  component: ConnectYahooPage,
});

// A league connected here is an ordinary createLeague/initializeSeasonTeams
// season row - infinidraft and infinileague pick it up automatically, since
// it's the same leagues/seasons tables (see ConnectYahooLeague's own
// comment for the exact mutations this calls).
function ConnectYahooPage() {
  const navigate = useNavigate();

  return (
    <PageContainer>
      <Stack gap="lg">
        <AppHeader />
        <ConnectYahooLeague
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
