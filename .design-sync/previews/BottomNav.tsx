import { BottomNav, type BottomNavItem } from "@infiniroot/shared";
import { PreviewRouter } from "../../shared/previewProviders";
import { DollarSign, LayoutGrid, Settings2, Tv, UserSearch } from "lucide-react";

const params = { leagueId: "demo" };

// BottomNav is `position: fixed`, not a portaled overlay - the capture
// harness's single-story wrapper (a transformed div, needed so fixed
// descendants render inside the card instead of escaping to the real
// viewport) only gets real height from IN-FLOW content. Without this
// explicit-height sibling box, the wrapper collapses to 0 height and the
// fixed bar's `bottom: 7px` resolves against that 0-height box, rendering
// almost entirely above the visible frame. Matches the declared
// cfg.overrides.BottomNav.viewport height (390x320).
function MobileFrame({ children }: { children: React.ReactNode }) {
  return <div style={{ height: 320 }}>{children}</div>;
}

export function Basic() {
  const items: BottomNavItem[] = [
    { value: "budget", label: "Budget", icon: DollarSign, to: "/league/$leagueId/budget", params },
    { value: "players", label: "Players", icon: UserSearch, to: "/league/$leagueId/players", params },
    { value: "league", label: "League", icon: LayoutGrid, to: "/league/$leagueId/league", params },
  ];
  return (
    <PreviewRouter>
      <MobileFrame>
        <BottomNav items={items} activeValue="players" />
      </MobileFrame>
    </PreviewRouter>
  );
}

export function WithOverflowMenu() {
  const items: BottomNavItem[] = [
    { value: "budget", label: "Budget", icon: DollarSign, to: "/league/$leagueId/budget", params },
    { value: "players", label: "Players", icon: UserSearch, to: "/league/$leagueId/players", params },
    { value: "league", label: "League", icon: LayoutGrid, to: "/league/$leagueId/league", params },
  ];
  const moreItems: BottomNavItem[] = [
    { value: "settings", label: "Settings", icon: Settings2, to: "/league/$leagueId/settings", params },
    {
      value: "tvBoard",
      label: "TV Board",
      icon: Tv,
      to: "/board/$leagueId",
      params,
      external: true,
    },
  ];
  return (
    <PreviewRouter>
      <MobileFrame>
        <BottomNav
          items={items}
          activeValue="players"
          more={{ label: "More", items: moreItems }}
        />
      </MobileFrame>
    </PreviewRouter>
  );
}

export function WithFabNotch() {
  const items: BottomNavItem[] = [
    { value: "budget", label: "Budget", icon: DollarSign, to: "/league/$leagueId/budget", params },
    { value: "players", label: "Players", icon: UserSearch, to: "/league/$leagueId/players", params },
    { value: "league", label: "League", icon: LayoutGrid, to: "/league/$leagueId/league", params },
  ];
  const moreItems: BottomNavItem[] = [
    { value: "settings", label: "Settings", icon: Settings2, to: "/league/$leagueId/settings", params },
  ];
  return (
    <PreviewRouter>
      <MobileFrame>
        <BottomNav
          items={items}
          activeValue="players"
          more={{ label: "More", items: moreItems }}
          hasFab
        />
      </MobileFrame>
    </PreviewRouter>
  );
}
