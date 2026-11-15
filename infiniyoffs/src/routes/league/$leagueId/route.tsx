import type { ReactNode } from "react";
import { Box, Center, Loader, Stack, Tabs } from "@mantine/core";
import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import type { GenericId as Id } from "convex/values";
import type { LucideIcon } from "lucide-react";
import { GitFork, Settings, Ticket, Trophy } from "lucide-react";
import { AppHeader } from "../../../components/AppHeader";
import { BottomNav } from "@shared/BottomNav";
import { PageContainer } from "@shared/PageContainer";
import { useMyViewer } from "../../../hooks/useMyViewer";
import { SeasonDataProvider, useSeasonData } from "../../../lib/seasonData";
import { TeamLogosProvider } from "@shared/glass/TeamLogo";

export const Route = createFileRoute("/league/$leagueId")({
  component: LeagueLayout,
});

type TabValue = "picture" | "bracket" | "matchups" | "settings";

interface TabItem {
  value: TabValue;
  label: string;
  icon: LucideIcon;
  to: string;
  params: Record<string, string>;
}

// infinileague's shell (glass header, top Tabs on desktop, glass
// BottomNav on mobile), but every query under it goes through
// requireSeasonViewer so an invited member can load it - infinileague's
// own tabs are owner-only.
function LeagueLayout() {
  const { leagueId } = Route.useParams();
  const seasonId = leagueId as Id<"seasons">;
  const location = useLocation();
  const viewer = useMyViewer(seasonId);

  const tabs: TabItem[] = [
    {
      value: "picture",
      label: "Picture",
      icon: Trophy,
      to: "/league/$leagueId",
      params: { leagueId },
    },
    {
      value: "bracket",
      label: "Bracket",
      icon: GitFork,
      to: "/league/$leagueId/bracket",
      params: { leagueId },
    },
    {
      value: "matchups",
      label: "Matchups",
      icon: Ticket,
      to: "/league/$leagueId/matchups",
      params: { leagueId },
    },
    {
      value: "settings",
      label: viewer?.isCommissioner ? "Settings" : "Rules",
      icon: Settings,
      to: "/league/$leagueId/settings",
      params: { leagueId },
    },
  ];

  const leaf = location.pathname.replace(`/league/${leagueId}`, "").replace(/^\/|\/$/g, "");
  const activeValue: TabValue | undefined =
    leaf === "" ? "picture" : tabs.find((tab) => tab.value === leaf)?.value;

  return (
    <PageContainer pb={{ base: 100, sm: "xl" }}>
      <Stack gap="md">
        <AppHeader />
        <Box visibleFrom="sm">
          <Tabs value={activeValue ?? null}>
            <Tabs.List>
              {tabs.map((tab) => (
                <Tabs.Tab
                  key={tab.value}
                  value={tab.value}
                  renderRoot={(props) => (
                    <Link {...({ to: tab.to, params: tab.params } as { to: "/" })} {...props} />
                  )}
                >
                  {tab.label}
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs>
        </Box>
        {viewer === undefined ? (
          <Center py="xl">
            <Loader />
          </Center>
        ) : (
          <SeasonDataProvider seasonId={seasonId}>
            <TeamLogos>
              <Outlet />
            </TeamLogos>
          </SeasonDataProvider>
        )}
      </Stack>
      <BottomNav glass items={tabs} activeValue={activeValue} />
    </PageContainer>
  );
}

// Every card's team logo, from the season data once it's loaded.
function TeamLogos({ children }: { children: ReactNode }) {
  const { data } = useSeasonData();
  return <TeamLogosProvider teams={data?.teams}>{children}</TeamLogosProvider>;
}
