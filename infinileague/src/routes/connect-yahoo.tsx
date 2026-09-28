import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Stack } from "@mantine/core";
import { AppHeader } from "../components/AppHeader";
import { PageContainer } from "@shared/PageContainer";
import { ConnectYahooLeague } from "@shared/ConnectYahooLeague";

export const Route = createFileRoute("/connect-yahoo")({
  component: ConnectYahooPage,
});

function ConnectYahooPage() {
  const navigate = useNavigate();

  return (
    <PageContainer>
      <Stack gap="lg">
        <AppHeader />
        <ConnectYahooLeague
          app="infinileague"
          onConnected={(seasonId) =>
            void navigate({ to: "/league/$leagueId", params: { leagueId: seasonId } })
          }
          onCancel={() => void navigate({ to: "/" })}
        />
      </Stack>
    </PageContainer>
  );
}
