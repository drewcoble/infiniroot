import { useState } from "react";
import type { GenericId as Id } from "convex/values";
import { Alert, Box, Button, Center, Loader, Stack, Tabs, Text } from "@mantine/core";
import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { Gavel, LayoutGrid, ListChecks, Settings, UserSearch } from "lucide-react";
import { AppHeader } from "../../../components/AppHeader";
import { BottomNav } from "@shared/BottomNav";
import { getErrorMessage } from "@shared/errors";
import { PageContainer } from "@shared/PageContainer";
import { useAuctionSettings } from "@shared-core/useAuctionSettings";
import { useMyParticipation } from "@shared-core/useMyParticipation";
import { useSetAuctionEnabled } from "@shared-core/useSetAuctionEnabled";

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
// lib/access.ts).
//
// One query IS made at this level now: getAuctionSettings (requireSeason
// Participant-backed, so it doesn't reject a non-owner either). A season
// whose weekly auction isn't enabled renders a blocking screen instead of
// Outlet/tabs - a user landing here (dashboard card, header switcher, a
// stale bookmark) previously had no way to tell the auction was off short of
// digging into the Settings tab, which is exactly the confusion this
// closes. The dashboard card (routes/index.tsx) is the main place an owner
// enables it, but the button below covers direct-link/switcher entry too.
function LeagueLayout() {
  const { leagueId } = Route.useParams();
  const seasonId = leagueId as Id<"seasons">;
  const location = useLocation();
  const navigate = useNavigate();

  const settings = useAuctionSettings(seasonId);
  const participation = useMyParticipation(seasonId);
  const setAuctionEnabled = useSetAuctionEnabled();
  const [enabling, setEnabling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleEnable = async () => {
    setEnabling(true);
    setError(null);
    try {
      await setAuctionEnabled({ seasonId, enabled: true });
    } catch (err) {
      setError(getErrorMessage(err, "Failed to enable the auction."));
    } finally {
      setEnabling(false);
    }
  };

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

  if (settings === undefined || participation === undefined) {
    return (
      <PageContainer pb={{ base: 100, sm: "xl" }}>
        <Stack gap="md">
          <AppHeader />
          <Center py="xl">
            <Loader />
          </Center>
        </Stack>
      </PageContainer>
    );
  }

  if (!settings.enabled) {
    const isCommissioner = participation?.isCommissioner ?? false;
    return (
      <PageContainer pb={{ base: 100, sm: "xl" }}>
        <Stack gap="md">
          <AppHeader />
          <Center py="xl">
            <Stack gap="sm" align="center" maw={420}>
              <Text fw={600}>This league's weekly auction isn't enabled</Text>
              <Text size="sm" c="dimmed" ta="center">
                {isCommissioner
                  ? "Enable it below, or from the dashboard card."
                  : "Ask your commissioner to enable it from the dashboard."}
              </Text>
              {isCommissioner && (
                <Button
                  color="green"
                  loading={enabling}
                  onClick={() => void handleEnable()}
                >
                  Enable weekly auction
                </Button>
              )}
              {error && (
                <Alert color="red" variant="light">
                  {error}
                </Alert>
              )}
              <Button variant="subtle" onClick={() => void navigate({ to: "/" })}>
                Back to dashboard
              </Button>
            </Stack>
          </Center>
        </Stack>
      </PageContainer>
    );
  }

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
