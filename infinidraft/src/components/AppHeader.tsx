import { Badge, Button, Menu, Text } from "@mantine/core";
import { Link, useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import { Check, CreditCard, Database, Plus, ShieldCheck, Trophy } from "lucide-react";
import { useMemo } from "react";
import { api } from "@infinidata/api";
import { AppHeader as SharedAppHeader } from "@shared/AppHeader";
import { DRAFT_STATUS_META } from "../lib/draftStatus";
import { BILLING_LINK_ENABLED } from "../lib/featureFlags";
import { groupSeasonsByLeague } from "@shared/leagueGroups";
import { setStoredLeagueId } from "../lib/leagueStorage";

const NEW_LEAGUE_VALUE = "new";

interface AppHeaderProps {
  // Hides just the league picker + mode-switch button, keeping the
  // overflow menu (Billing/Go Pro, Admin, Data, theme, sign out) - for the
  // dashboard (routes/index.tsx), which has a signed-in user but no
  // "current league" to show either of those for (the dashboard's own
  // league-card grid already *is* the league picker).
  hideLeagueControls?: boolean;
}

// Thin infinidraft-specific wrapper around @shared/AppHeader: fetches this
// app's own league/user/entitlement data, builds the league-picker dropdown
// content (owned/shared split with draft-status badges, "New League"
// footer) and the Billing/Admin/Data overflow items, and the Setup/Draft
// Room mode-switch button - all things the other two apps don't have.
//
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
  const entitlement = useQuery(api.infinidraft.billing.queries.getMyEntitlement);

  const inSeason = location.pathname.startsWith("/season");
  const selectedLeague = seasonsList?.find((l) => l._id === leagueId);
  // The picker shows one entry per real-world league, not one per year -
  // group the flat seasons list (see leagues.listSeasons) by leagueId and
  // surface only the most recent season of each so "New League" duplicates
  // from prior-season imports/rollovers don't clutter the dropdown.
  const leagueGroups = useMemo(
    () => groupSeasonsByLeague(seasonsList ?? []),
    [seasonsList],
  );
  // Split owned leagues from ones shared via a co-manager invite (see
  // leagues.listSeasons' isOwner field) so the picker never leaves it
  // ambiguous whose league you're looking at - a group's isOwner is the
  // same for every season in it (it's really a per-league fact), so
  // `latest.isOwner` alone is enough to bucket the whole group.
  const ownedGroups = leagueGroups.filter((g) => g.latest.isOwner !== false);
  const sharedGroups = leagueGroups.filter((g) => g.latest.isOwner === false);

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

  const renderLeagueGroup = ({
    latest,
    seasons,
  }: (typeof leagueGroups)[number]) => {
    const statusMeta = DRAFT_STATUS_META[latest.draftStatus];
    return (
      <Menu.Item
        key={latest.leagueId}
        leftSection={
          seasons.some((s) => s._id === leagueId) ? <Check size={16} /> : null
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
  };

  // Only split into labeled sections once there's actually something to
  // disambiguate - a user with no shared leagues sees the same flat list as
  // before.
  const leagueMenuItems = (
    <>
      {sharedGroups.length > 0 && <Menu.Label>My Leagues</Menu.Label>}
      {ownedGroups.map(renderLeagueGroup)}
      {sharedGroups.length > 0 && (
        <>
          <Menu.Label>Shared</Menu.Label>
          {sharedGroups.map(renderLeagueGroup)}
        </>
      )}
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
  // public link, surfaced via extraOverflowItems below). Renders nothing
  // otherwise (e.g. already on the League view, or no real league
  // selected).
  const modeSwitchSlot = inSeason ? (
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
    <SharedAppHeader
      wordmark="draft"
      hideLeagueControls={hideLeagueControls}
      selectedLeagueLabel={selectedLeague?.name}
      leagueMenuItems={leagueMenuItems}
      modeSwitchSlot={modeSwitchSlot}
      leagueButtonWidth={{ base: 130, sm: 220 }}
      extraOverflowItems={
        <>
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
                <Menu.Item component="span" leftSection={<ShieldCheck size={16} />}>
                  Admin
                </Menu.Item>
              </Link>
              <Link to="/admin-data" style={{ textDecoration: "none" }}>
                <Menu.Item component="span" leftSection={<Database size={16} />}>
                  Data
                </Menu.Item>
              </Link>
            </>
          )}
        </>
      }
    />
  );
}
