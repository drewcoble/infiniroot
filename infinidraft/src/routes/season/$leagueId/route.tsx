import { Box, Button, Center, Loader, Stack, Tabs, Text } from "@mantine/core";
import {
  createFileRoute,
  Link,
  Outlet,
  useLocation,
} from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { Settings2 } from "lucide-react";
import { api } from "@infinidata/api";
import type { Id } from "@infinidata/dataModel";
import { AppHeader } from "../../../components/AppHeader";
import { BottomNav } from "../../../components/BottomNav";
import { PageContainer } from "@shared/PageContainer";
import { useSelfTeam } from "../../../hooks/useSelfTeam";

export const Route = createFileRoute("/season/$leagueId")({
  component: SeasonLayout,
});

const TABS = [
  {
    value: "settings",
    label: "Settings",
    icon: Settings2,
    to: "/season/$leagueId/settings",
  },
] as const;

// Mirrors src/routes/league/$leagueId/route.tsx's layout - same
// AppHeader/tabs/BottomNav shell, just for the post-draft "Season" mode.
// No in-app entry point links here anymore (the old AppHeader "Enter
// Season" button was removed as part of scoping the app down to purely a
// draft tool - Report Card moved out to its own public route,
// src/routes/reportCard/$leagueId.tsx); reachable only by a direct URL.
function SeasonLayout() {
  const { leagueId } = Route.useParams();
  const location = useLocation();
  const settingsList = useQuery(api.leagues.listSeasons, {});
  const selfTeamResult = useSelfTeam(leagueId as Id<"seasons">);

  const settings = settingsList?.find((s) => s._id === leagueId);
  const activeTab = location.pathname.split("/").pop();

  if (settingsList === undefined || selfTeamResult === undefined) {
    return (
      <>
        <AppHeader />
        <PageContainer>
          <Center>
            <Loader />
          </Center>
        </PageContainer>
      </>
    );
  }

  if (!settings) {
    return (
      <>
        <AppHeader />
        <PageContainer>
          <Stack gap="md" py="xl" align="center">
            <Text c="dimmed">League not found.</Text>
            <Link to="/">
              <Button component="span" variant="default">
                Back to settings
              </Button>
            </Link>
          </Stack>
        </PageContainer>
      </>
    );
  }

  const { selfTeam } = selfTeamResult;

  return (
    <PageContainer pb={{ base: 100, sm: "xl" }}>
      <Stack gap="md">
        <AppHeader />
        <Box visibleFrom="sm">
          <Tabs value={activeTab ?? null}>
            <Tabs.List>
              {TABS.map((tab) => (
                <Tabs.Tab
                  key={tab.value}
                  value={tab.value}
                  renderRoot={(props) => (
                    <Link to={tab.to} params={{ leagueId }} {...props} />
                  )}
                >
                  {tab.label}
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs>
        </Box>
        <BottomNav items={TABS} leagueId={leagueId} />
        {selfTeam ? (
          <Outlet />
        ) : (
          <Text c="dimmed" ta="center" py="xl">
            Set up your draft teams first.
          </Text>
        )}
      </Stack>
    </PageContainer>
  );
}
