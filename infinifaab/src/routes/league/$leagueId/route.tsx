import { Box, Stack, Tabs } from "@mantine/core";
import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { Gavel, LayoutGrid, ListChecks, Settings, UserSearch } from "lucide-react";
import { AppHeader } from "../../../components/AppHeader";
import { BottomNav } from "@shared/BottomNav";
import { PageContainer } from "@shared/PageContainer";

export const Route = createFileRoute("/league/$leagueId")({
  component: LeagueLayout,
});

type TabValue = "dashboard" | "players" | "myBids" | "results" | "settings";

interface TabItem {
  value: TabValue;
  label: string;
  icon: LucideIcon;
  to: string;
  params: Record<string, string>;
}

const BOTTOM_NAV_DIRECT_COUNT = 4;

// Deliberately its own shell, not infinileague's LeagueLayout - that one's
// tab content calls requireSeasonOwner-backed queries (getStandings), which
// would reject an invited (non-owner) team member outright. Every query
// this shell's own tabs use instead goes through requireSeasonParticipant/
// requireTeamAccess, so an invited user can load this shell at all - see
// AUCTION_PLAN's "Convex: who can access what" section (infinidata/convex/
// lib/access.ts). No query here at the shell level itself, only in each
// tab's own page - so there's nothing here to reject a non-owner on.
function LeagueLayout() {
  const { leagueId } = Route.useParams();
  const location = useLocation();

  const tabs: TabItem[] = [
    {
      value: "dashboard",
      label: "Dashboard",
      icon: LayoutGrid,
      to: "/league/$leagueId",
      params: { leagueId },
    },
    {
      value: "players",
      label: "Players",
      icon: UserSearch,
      to: "/league/$leagueId/players",
      params: { leagueId },
    },
    {
      value: "myBids",
      label: "Bids",
      icon: Gavel,
      to: "/league/$leagueId/myBids",
      params: { leagueId },
    },
    {
      value: "results",
      label: "Results",
      icon: ListChecks,
      to: "/league/$leagueId/results",
      params: { leagueId },
    },
    {
      value: "settings",
      label: "Settings",
      icon: Settings,
      to: "/league/$leagueId/settings",
      params: { leagueId },
    },
  ];

  const activeValue: TabValue | undefined =
    location.pathname === `/league/${leagueId}` ||
    location.pathname === `/league/${leagueId}/`
      ? "dashboard"
      : location.pathname === `/league/${leagueId}/players`
        ? "players"
        : location.pathname === `/league/${leagueId}/myBids`
          ? "myBids"
          : location.pathname === `/league/${leagueId}/results`
            ? "results"
            : location.pathname === `/league/${leagueId}/settings`
              ? "settings"
              : undefined;

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
                    <Link
                      {...({ to: tab.to, params: tab.params } as { to: "/" })}
                      {...props}
                    />
                  )}
                >
                  {tab.label}
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs>
        </Box>
        <Outlet />
      </Stack>
      <BottomNav
        items={tabs.slice(0, BOTTOM_NAV_DIRECT_COUNT)}
        more={{ label: "More", items: tabs.slice(BOTTOM_NAV_DIRECT_COUNT) }}
        activeValue={activeValue}
      />
    </PageContainer>
  );
}
