import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Stack } from "@mantine/core";
import { AppHeader } from "../components/AppHeader";
import { PageContainer } from "@shared/PageContainer";
import { ConnectSleeperLeague } from "../components/ConnectSleeperLeague";

export const Route = createFileRoute("/connect-sleeper")({
  component: ConnectSleeperPage,
});

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
