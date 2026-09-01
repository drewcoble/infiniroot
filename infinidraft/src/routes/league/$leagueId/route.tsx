import { Box, Center, Group, Loader, Stack, Tabs } from "@mantine/core";
import {
  createFileRoute,
  Link,
  Outlet,
  useLocation,
} from "@tanstack/react-router";
import { useQuery } from "convex/react";
import {
  CircleUserRound,
  DollarSign,
  HeartPulse,
  LayoutGrid,
  ListChecks,
  Settings2,
  UserCheck,
  UserSearch,
} from "lucide-react";
import { api } from "@infinidata/api";
import type { Id } from "@infinidata/dataModel";
import { AppHeader } from "../../../components/AppHeader";
import { BottomNav } from "../../../components/BottomNav";
import { PageContainer } from "@shared/PageContainer";
import { MOBILE_STATS_ROW_HEIGHT } from "../../../constants/general";
import { MOBILE_HEADER_HEIGHT } from "@shared/constants";
import { useDraftPhase } from "../../../hooks/useDraftPhase";
import { useSelfTeam } from "../../../hooks/useSelfTeam";
import { DraftTopBar } from "../../../pages/DraftRoom/DraftTopBar";
import { MobileSnakeDraft } from "../../../pages/DraftRoom/components/MobileSnakeDraft";

export const Route = createFileRoute("/league/$leagueId")({
  component: LeagueLayout,
});

type TabValue =
  | "settings"
  | "keepers"
  | "budget"
  | "players"
  | "myTeam"
  | "injuries"
  | "league"
  | "draft";

// Shared metadata, keyed by value - the two phases below reorder and
// regroup these same eight tabs rather than defining separate copies.
const TAB_META: Record<
  TabValue,
  { label: string; icon: typeof Settings2; to: string }
> = {
  settings: {
    label: "Settings",
    icon: Settings2,
    to: "/league/$leagueId/settings",
  },
  keepers: {
    label: "Keepers",
    icon: UserCheck,
    to: "/league/$leagueId/keepers",
  },
  budget: {
    label: "Budget",
    icon: DollarSign,
    to: "/league/$leagueId/budget",
  },
  players: {
    label: "Players",
    icon: UserSearch,
    to: "/league/$leagueId/players",
  },
  myTeam: {
    label: "My Team",
    icon: CircleUserRound,
    to: "/league/$leagueId/myTeam",
  },
  injuries: {
    label: "Injuries",
    icon: HeartPulse,
    to: "/league/$leagueId/injuries",
  },
  // The live per-team roster breakdown (see league.tsx) is a
  // draft-in-progress reference tool.
  league: {
    label: "League",
    icon: LayoutGrid,
    to: "/league/$leagueId/league",
  },
  draft: {
    label: "Draft",
    icon: ListChecks,
    to: "/league/$leagueId/draft",
  },
};

// Two entirely separate orderings/groupings, not just a reshuffle of one
// list - pre-draft is about setting the league up (Settings first), once
// the draft's live the auction tools (Budget/Players) and in-draft
// reference views (League/Draft) matter more than one-time setup.
const PRE_DRAFT_ORDER: TabValue[] = [
  "settings",
  "keepers",
  "budget",
  "players",
  "myTeam",
  "injuries",
  "league",
  "draft",
];
// The first N of the *visible* order fill the direct slots (see
// visibleValues below) - positional rather than a fixed value set, so if
// keepers is off and drops out of the list entirely, myTeam backfills the
// 4th direct slot instead of leaving only 3.
const PRE_DRAFT_DIRECT_COUNT = 4;

const STARTED_ORDER: TabValue[] = [
  "budget",
  "players",
  "league",
  "draft",
  "myTeam",
  "injuries",
  "settings",
  "keepers",
];
// Only 3 direct slots once started (not 4) - the nominate FAB takes the
// bottom nav's center gap, so 3 tab buttons + the More button splits 2+2
// around it instead of the pre-draft 4-tabs-no-FAB layout.
const STARTED_DIRECT_COUNT = 3;

const toBottomNavItem = (value: TabValue) => ({
  value,
  ...TAB_META[value],
});

// Single merged layout for the whole season lifecycle - previously two
// separate trees (/setup and /draft) that let a user be "in" both at once.
// Every tab is always reachable; individual tabs/fields lock themselves once
// the draft starts (see LeagueDetails.tsx's isStarted-driven locks) rather
// than this layout hiding anything structural.
function LeagueLayout() {
  const { leagueId } = Route.useParams();
  const location = useLocation();
  const isNew = leagueId === "new";
  const seasonId = isNew ? undefined : (leagueId as Id<"seasons">);

  const settingsList = useQuery(api.leagues.listSeasons, {});
  const settings = settingsList?.find((s) => s._id === leagueId);
  const entitlement = useQuery(api.infinidraft.billing.queries.getMyEntitlement);
  const phase = useDraftPhase(seasonId);
  // Only mounted once started (see below) - no teams/no self team pre-start
  // is completely normal (teams are created on the Settings tab, in this
  // same layout), so there's nothing to guard against here the way the old
  // Draft Room layout did.
  const selfTeamResult = useSelfTeam(seasonId);
  const isStarted = phase?.isStarted ?? false;

  const activeTab = location.pathname.split("/").pop();

  if (settingsList === undefined) {
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

  // Absent means "auction" (see convex/draftType.ts's resolveDraftType,
  // duplicated inline here rather than imported - src/ never imports
  // runtime convex/ modules directly, only _generated types/api).
  const draftType = settings?.draftType ?? "auction";
  const isAuction = draftType === "auction";

  // Absent means true (see schema.ts's useKeepers comment) - don't hide the
  // tab while settings is still loading, only once positively known off.
  // Only applies to Pro leagues though - a free-tier league always shows
  // the tab (regardless of the setting) so clicking it lands on the
  // non-dismissible upgrade prompt (see keepers.tsx's Pro gate) instead of
  // the tab just vanishing, which read as the feature not existing at all.
  // Keepers now supports snake/linear too (SNAKE_DRAFT.md §8, round-based
  // cost) - unlike Budget, no longer auction-only.
  const hasProAccess = entitlement?.hasProAccess ?? false;
  const keepersEnabled = !hasProAccess || settings?.useKeepers !== false;
  // Budget planning is auction-only too (SNAKE_DRAFT.md §3.4) - no
  // $-plan-vs-actual concept exists for a snake/linear draft.
  const budgetEnabled = isAuction;
  const order = isStarted ? STARTED_ORDER : PRE_DRAFT_ORDER;
  const directCount = isStarted ? STARTED_DIRECT_COUNT : PRE_DRAFT_DIRECT_COUNT;
  const visibleValues = order.filter(
    (value) =>
      (value !== "keepers" || keepersEnabled) &&
      (value !== "budget" || budgetEnabled),
  );
  const visibleTabs = visibleValues.map((value) => ({
    value,
    ...TAB_META[value],
  }));
  const bottomNavItems = visibleValues
    .slice(0, directCount)
    .map(toBottomNavItem);
  const bottomNavMoreItems = visibleValues
    .slice(directCount)
    .map(toBottomNavItem);

  // pos="relative" + zIndex needed so this outranks the Keepers route's
  // non-dismissible free-plan upgrade Modal (zIndex 190, see keepers.tsx) -
  // without a positioned ancestor here, this Box has no stacking context of
  // its own and renders underneath the modal's fixed overlay, same
  // reasoning as BottomNav's zIndex below, so a free-plan visitor could
  // open Keepers but never click back out to another tab on desktop.
  const mainColumn = (
    <>
      <Box visibleFrom="sm" pos="relative" style={{ zIndex: 200 }}>
        <Tabs value={activeTab ?? null}>
          <Tabs.List>
            {visibleTabs.map((tab) => (
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
      <Outlet />
    </>
  );

  return (
    <PageContainer
      pt={{
        base:
          (isStarted && isAuction ? MOBILE_STATS_ROW_HEIGHT : 0) +
          MOBILE_HEADER_HEIGHT +
          16,
        sm: "xl",
      }}
      pb={{ base: isStarted ? 230 : 116, sm: "xl" }}
    >
      <Stack gap="md">
        <AppHeader />
        {/* Started auction drafts dock the nominate/bid/stats sidebar
            (DraftTopBar) beside the tab content, not above it (see the
            Draft Bar Sidebar Redesign mockup, "Infinidraft UX review"
            Claude Design project) - so it stays visible while scrolling a
            long Players/League table instead of scrolling away with the
            page. Auction-only (AUCTION.md) - snake/linear has no
            nominate/bid/budget-stats concept, so those leagues (and
            pre-draft leagues) keep the plain single-column layout below. */}
        {isStarted && isAuction && selfTeamResult?.selfTeam && seasonId ? (
          <Group align="flex-start" gap="lg" wrap="nowrap">
            <DraftTopBar
              seasonId={seasonId}
              selfTeamId={selfTeamResult.selfTeam._id}
            />
            <Stack gap="md" style={{ flex: 1, minWidth: 0 }}>
              {mainColumn}
            </Stack>
          </Group>
        ) : (
          mainColumn
        )}
        {/* Deliberately a direct child of this Stack rather than part of
            mainColumn above - BottomNav is position: fixed chrome, not
            column content, and nesting it inside the sidebar branch's
            Group > Stack gives WebKit/iOS an ancestor box to resolve
            `bottom` against instead of the viewport, which floats the bar
            partway up the page. Being out of flow, it costs no flex gap
            here. */}
        <BottomNav
          items={bottomNavItems}
          more={{ label: "More", items: bottomNavMoreItems }}
          leagueId={leagueId}
          hasFab={isStarted}
        />
        {/* Snake/linear's mobile counterpart to the auction FAB above -
            BottomNav already reserves its center notch for any started
            draft (hasFab={isStarted}), but until now only auction actually
            filled it. Mounted at the layout level, like DraftTopBar, so a
            pick can be made from any tab rather than only the Draft one
            (SnakeDraftTab's inline table remains the desktop path - this
            component hides itself above "sm"). */}
        {isStarted && !isAuction && !!selfTeamResult?.teams.length && seasonId && (
          <MobileSnakeDraft
            seasonId={seasonId}
            teams={selfTeamResult.teams}
          />
        )}
      </Stack>
    </PageContainer>
  );
}
