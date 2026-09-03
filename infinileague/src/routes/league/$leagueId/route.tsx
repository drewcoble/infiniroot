import { Box, Stack, Tabs } from "@mantine/core";
import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import type { LucideIcon } from "lucide-react";
import { CircleUserRound, Trophy, UserSearch, Users } from "lucide-react";
import { api } from "@infinidata/api";
import { AppHeader } from "../../../components/AppHeader";
import { BottomNav } from "../../../components/BottomNav";
import { PageContainer } from "@shared/PageContainer";
import type { StandingsRow } from "../../../types/season";

export const Route = createFileRoute("/league/$leagueId")({
  component: LeagueLayout,
});

type TabValue = "standings" | "myTeam" | "freeAgents" | "players";

interface TabItem {
  value: TabValue;
  label: string;
  icon: LucideIcon;
  to: string;
  params: Record<string, string>;
}

// Standings, Free Agents, and Players are always reachable; "My Team" only
// once the self team is known (it needs a concrete teamId param, unlike
// infinidraft's flat per-league tabs) so it's appended conditionally below
// rather than listed here.
const STANDINGS_VALUE: TabValue = "standings";

// Same "top Tabs on desktop, fixed BottomNav on mobile" shell infinidraft's
// own league/$leagueId/route.tsx uses, scaled down to infinileague's two
// pages - AppHeader/PageContainer now live here (once per layout mount)
// instead of being duplicated in each child route file, and every child
// route (index.tsx, teams/$teamId.tsx) renders bare content straight into
// this layout's Outlet, the same way infinidraft's settings.tsx/myTeam.tsx/
// etc. do.
function LeagueLayout() {
  const { leagueId } = Route.useParams();
  const location = useLocation();
  const { isAuthenticated } = useConvexAuth();
  const seasonId = leagueId as Id<"seasons">;

  // Standings already carries an isSelf flag per row (see convex/season/
  // standings.ts) - reused here instead of a dedicated "my team" query, same
  // as the team page itself reusing this query for the header card.
  const standings: StandingsRow[] | undefined = useQuery(
    api.infinileague.season.standings.getStandings,
    isAuthenticated ? { seasonId } : "skip",
  );
  const selfTeam = standings?.find((row) => row.isSelf);

  const tabs: TabItem[] = [
    {
      value: STANDINGS_VALUE,
      label: "Standings",
      icon: Trophy,
      to: "/league/$leagueId",
      params: { leagueId },
    },
    ...(selfTeam
      ? [
          {
            value: "myTeam" as const,
            label: "My Team",
            icon: CircleUserRound,
            to: "/league/$leagueId/teams/$teamId",
            params: { leagueId, teamId: selfTeam.teamId },
          },
        ]
      : []),
    {
      value: "freeAgents",
      label: "Free Agents",
      icon: UserSearch,
      to: "/league/$leagueId/freeAgents",
      params: { leagueId },
    },
    {
      value: "players",
      label: "Players",
      icon: Users,
      to: "/league/$leagueId/players",
      params: { leagueId },
    },
  ];

  // Path-based rather than TAB_META's exact route string, since the
  // standings tab's own route has no trailing segment to match against (the
  // way infinidraft's `pathname.split("/").pop()` compares against each
  // tab's flat leaf segment). "My Team" only lights up on the self team's
  // own team page specifically - viewing another team (e.g. clicked from
  // the standings table) is still the /teams/$teamId route, but it isn't
  // "My Team", so it shouldn't claim that tab as active.
  const activeValue: TabValue | undefined =
    location.pathname === `/league/${leagueId}` ||
    location.pathname === `/league/${leagueId}/`
      ? "standings"
      : selfTeam && location.pathname === `/league/${leagueId}/teams/${selfTeam.teamId}`
        ? "myTeam"
        : location.pathname === `/league/${leagueId}/freeAgents`
          ? "freeAgents"
          : location.pathname === `/league/${leagueId}/players`
            ? "players"
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
      <BottomNav items={tabs} activeValue={activeValue} />
    </PageContainer>
  );
}
