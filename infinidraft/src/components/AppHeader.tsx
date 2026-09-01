import { useAuthActions } from "@convex-dev/auth/react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Menu,
  Text,
  useMantineColorScheme,
} from "@mantine/core";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
// useConvexAuth from convex/react, not @convex-dev/auth/react - see
// __root.tsx's comment on the same import for why (the latter's
// isAuthenticated doesn't wait for server confirmation).
import { useConvexAuth, useQuery } from "convex/react";
import {
  Check,
  ChevronDown,
  CreditCard,
  Database,
  GraduationCap,
  LogOut,
  Moon,
  MoreVertical,
  Plus,
  ShieldCheck,
  Sun,
  Trophy,
  Tv,
} from "lucide-react";
import { useMemo } from "react";
import { api } from "@infinidata/api";
import type { Id } from "@infinidata/dataModel";
import { MOBILE_HEADER_HEIGHT } from "@shared/constants";
import { DRAFT_STATUS_META } from "../lib/draftStatus";
import { BILLING_LINK_ENABLED } from "../lib/featureFlags";
import { groupSeasonsByLeague } from "@shared/leagueGroups";
import { setStoredLeagueId } from "../lib/leagueStorage";
import { useDraftPhase } from "../hooks/useDraftPhase";
import { AppLogo } from "@shared/AppLogo";

const NEW_LEAGUE_VALUE = "new";

// Shared top bar for both the Setup and Draft Room screens - league picker
// (+ New League), the Setup/Draft Room mode switch, and sign out. Reads
// which league/section is current from the URL rather than local state.
//
// TV Board (any real league, any draft phase - see DraftBoard.tsx)/Report
// Card (once the draft's complete - see DraftReportCard.tsx)/theme
// toggle/sign out all collapse into one
// overflow menu at every breakpoint, rather than spreading across inline
// buttons on desktop - keeps the bar from getting crowded as more
// draft-room-only actions get added. The league picker is the same
// button-triggered menu at every breakpoint too, just narrower on mobile
// (name still truncates rather than disappearing, so which league is
// selected stays legible at a glance).
//
// Also fixed to the top of the viewport on mobile (native-app-style) rather
// than scrolling away with the page - callers must reserve
// MOBILE_HEADER_HEIGHT of top padding on mobile so page content doesn't
// start out hidden underneath it (see setup/draft route layouts).
interface AppHeaderProps {
  // Hides just the league picker + mode-switch button, keeping the
  // overflow menu (Billing/Go Pro, Admin, theme, sign out) - for the
  // dashboard (routes/index.tsx), which has a signed-in user but no
  // "current league" to show either of those for (the dashboard's own
  // league-card grid already *is* the league picker).
  hideLeagueControls?: boolean;
}

// Only ever rendered once a session is confirmed authenticated - the
// signed-out/loading screens (routes/__root.tsx) use SignedOutHeader.tsx
// instead, a completely query-free shell, rather than this component with
// everything below hidden. That used to be this component's job (see its
// git history's now-removed `minimal` prop), but even with the league/user
// menu hidden, the queries below still ran - not worth the risk of any of
// them firing before a session is genuinely confirmed.
export function AppHeader({ hideLeagueControls = false }: AppHeaderProps = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { leagueId } = useParams({ strict: false });
  const { signOut } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();
  const currentUser = useQuery(api.users.getCurrentUser);
  // Still gated on isAuthenticated as a second line of defense - __root.tsx
  // only renders this component at all once it believes the user is
  // authenticated, but listSeasons throws (rather than degrading
  // gracefully like getCurrentUser/getMyEntitlement above) if that belief
  // turns out to be premature.
  const seasonsList = useQuery(
    api.leagues.listSeasons,
    isAuthenticated ? {} : "skip",
  );
  const entitlement = useQuery(api.billing.queries.getMyEntitlement);
  const { colorScheme, setColorScheme } = useMantineColorScheme();

  const inLeagueView = location.pathname.startsWith("/league");
  const inSeason = location.pathname.startsWith("/season");
  const hasRealLeague = !!leagueId && leagueId !== NEW_LEAGUE_VALUE;
  const isDark = colorScheme === "dark";
  const selectedLeague = seasonsList?.find((l) => l._id === leagueId);
  // The picker shows one entry per real-world league, not one per year -
  // group the flat seasons list (see leagues.listSeasons) by leagueId and
  // surface only the most recent season of each so "New League" duplicates
  // from prior-season imports/rollovers don't clutter the dropdown.
  const leagueGroups = useMemo(
    () => groupSeasonsByLeague(seasonsList ?? []),
    [seasonsList],
  );
  // Single source of truth for phase (see useDraftPhase) - replaces the old
  // client-side isDraftComplete recomputation, which read raw pick count
  // and so double-counted keepers the same way the pre-refactor
  // drafts.status derivation did.
  const phase = useDraftPhase(
    hasRealLeague ? (leagueId as Id<"seasons">) : undefined,
  );
  const draftComplete = phase?.isComplete ?? false;

  const handleLeagueChange = (value: string | null) => {
    if (!value) return;
    if (value === NEW_LEAGUE_VALUE) {
      void navigate({
        to: "/league/$leagueId/settings",
        params: { leagueId: NEW_LEAGUE_VALUE },
      });
      return;
    }
    if (currentUser) {
      setStoredLeagueId(currentUser._id, value);
    }
    void navigate({
      to: ".",
      params: (prev) => ({ ...prev, leagueId: value }),
    });
  };

  const leagueMenuItems = (
    <>
      {leagueGroups.map(({ latest, seasons }) => {
        const statusMeta = DRAFT_STATUS_META[latest.draftStatus];
        return (
          <Menu.Item
            key={latest.leagueId}
            leftSection={
              seasons.some((s) => s._id === leagueId) ? (
                <Check size={16} />
              ) : null
            }
            rightSection={
              <Badge size="xs" variant="light" color={statusMeta.color}>
                {statusMeta.label}
              </Badge>
            }
            onClick={() => handleLeagueChange(latest._id)}
          >
            {latest.name}
          </Menu.Item>
        );
      })}
      <Menu.Divider />
      <Menu.Item
        leftSection={<Plus size={16} />}
        onClick={() => handleLeagueChange(NEW_LEAGUE_VALUE)}
      >
        New League
      </Menu.Item>
    </>
  );

  // Only ever needs to get someone back from the post-draft Season view now
  // - there's no forward direction into it anymore (see the removed "Enter
  // Season" button; the app is scoped to purely a draft tool, and Report
  // Card - the one thing that used to live in Season - moved to its own
  // public link, surfaced below in the overflow menu instead). Renders
  // nothing otherwise (e.g. already on the League view, or no real league
  // selected).
  const modeSwitchButton = inSeason ? (
    <Link
      to="/league/$leagueId/settings"
      params={{ leagueId: leagueId ?? NEW_LEAGUE_VALUE }}
    >
      <Button component="span" variant="light" size="sm" color="burlywood">
        <Text hiddenFrom="sm" component="span" inherit>
          League
        </Text>
        <Text visibleFrom="sm" component="span" inherit>
          Back to League
        </Text>
      </Button>
    </Link>
  ) : null;

  return (
    <Box
      pos={{ base: "fixed", sm: "static" }}
      top={0}
      left={0}
      right={0}
      px={{ base: "md", sm: 0 }}
      py={{ base: "sm", sm: "xs" }}
      h={{ base: MOBILE_HEADER_HEIGHT, sm: "auto" }}
      style={{
        // Above the Keepers route's non-dismissible free-plan upgrade Modal
        // (zIndex 190, see keepers.tsx) so that "can't close it" block never
        // covers the header itself, but below BottomNav's 200 - AppHeader
        // (top-fixed) and BottomNav (bottom-fixed) never occupy the same
        // pixels on any real viewport, so their relative order doesn't
        // otherwise matter, and keeping AppHeader under BottomNav lets
        // MobileNomination's bottom-sheet Drawer sit in between the two
        // (above AppHeader, below BottomNav) instead of needing to either
        // outrank BottomNav too or physically avoid ever reaching this bar.
        zIndex: 195,
        display: "flex",
        alignItems: "center",
        // Translucent + blurred rather than a flat cutout - same frosted-
        // glass treatment as BottomNav.tsx, so content scrolling underneath
        // the fixed mobile header still shows through softly instead of
        // vanishing behind a hard edge.
        background:
          "color-mix(in srgb, var(--mantine-color-body) 75%, transparent)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderBottom: "1px solid var(--mantine-color-default-border)",
      }}
    >
      <Group
        justify="space-between"
        align="center"
        wrap="nowrap"
        gap="xs"
        style={{ flex: 1, minWidth: 0 }}
      >
        <Link to="/" style={{ flexShrink: 0, textDecoration: "none" }}>
          {/* Hidden below "sm" by default - the league picker and
              mode-switch button need the room on mobile. hideLeagueControls
              callers (e.g. the dashboard) have room to spare, so the
              wordmark stays visible there instead. */}
          <AppLogo wordmark="draft" wordmarkAlwaysVisible={hideLeagueControls} />
        </Link>
        <Group gap="xs" wrap="nowrap" align="center" style={{ flexShrink: 0 }}>
          {!hideLeagueControls && (
            <>
              <Menu position="bottom-end" withArrow offset={8} width={260}>
                <Menu.Target>
                  <Button
                    variant="default"
                    size="sm"
                    w={{ base: 130, sm: 220 }}
                    justify="space-between"
                    rightSection={<ChevronDown size={16} />}
                  >
                    <Text truncate span>
                      {selectedLeague ? selectedLeague.name : "Select league"}
                    </Text>
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>{leagueMenuItems}</Menu.Dropdown>
              </Menu>
              {modeSwitchButton}
            </>
          )}
          <Menu position="bottom-end" withArrow offset={8}>
            <Menu.Target>
              <ActionIcon variant="default" size={40} aria-label="More options">
                <MoreVertical size={18} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              {inLeagueView && hasRealLeague && (
                <Link
                  to="/board/$leagueId"
                  params={{ leagueId }}
                  target="_blank"
                  style={{ textDecoration: "none" }}
                >
                  <Menu.Item component="span" leftSection={<Tv size={16} />}>
                    TV Board
                  </Menu.Item>
                </Link>
              )}
              {inLeagueView && hasRealLeague && draftComplete && (
                <Link
                  to="/reportCard/$leagueId"
                  params={{ leagueId }}
                  target="_blank"
                  style={{ textDecoration: "none" }}
                >
                  <Menu.Item
                    component="span"
                    leftSection={<GraduationCap size={16} />}
                  >
                    Report Card
                  </Menu.Item>
                </Link>
              )}
              {BILLING_LINK_ENABLED && (
                <Link to="/billing" style={{ textDecoration: "none" }}>
                  <Menu.Item
                    component="span"
                    leftSection={
                      entitlement?.hasProAccess ? (
                        <CreditCard size={16} />
                      ) : (
                        <Trophy size={16} />
                      )
                    }
                  >
                    {entitlement?.hasProAccess ? "Billing" : "Go Pro"}
                  </Menu.Item>
                </Link>
              )}
              {currentUser?.role === "super-admin" && (
                <>
                  <Link to="/admin" style={{ textDecoration: "none" }}>
                    <Menu.Item
                      component="span"
                      leftSection={<ShieldCheck size={16} />}
                    >
                      Admin
                    </Menu.Item>
                  </Link>
                  <Link to="/admin-data" style={{ textDecoration: "none" }}>
                    <Menu.Item
                      component="span"
                      leftSection={<Database size={16} />}
                    >
                      Data
                    </Menu.Item>
                  </Link>
                </>
              )}
              <Menu.Item
                leftSection={isDark ? <Sun size={16} /> : <Moon size={16} />}
                onClick={() => setColorScheme(isDark ? "light" : "dark")}
              >
                {isDark ? "Light mode" : "Dark mode"}
              </Menu.Item>
              <Menu.Item
                leftSection={<LogOut size={16} />}
                onClick={() => {
                  // Awaited, not fire-and-forget - navigating before the
                  // auth token actually clears left whatever
                  // authenticated route was still mounted (e.g. a league
                  // page's requireSeasonOwner query) racing the sign-out,
                  // so it could get invalidated mid-flight and throw
                  // "must be signed in" - caught by __root.tsx's error
                  // boundary with no way back to the sign-in form short
                  // of a hard reload.
                  void (async () => {
                    await signOut();
                    // Otherwise the next sign-in (possibly a different
                    // account on this browser) re-renders whatever league
                    // route was still in the address bar, which fails
                    // that owner check as "not authorized" if it
                    // belonged to whoever was signed in before.
                    await navigate({ to: "/", replace: true });
                  })();
                }}
              >
                Sign out
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>
    </Box>
  );
}
