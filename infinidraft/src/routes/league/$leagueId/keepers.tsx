import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { Center, Loader, Modal, Stack, Text } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { api } from "@infinidata/api";
import type { Id } from "@infinidata/dataModel";
import { KeepersTab } from "../../../pages/Settings/KeepersTab";
import { UpgradePrompt } from "../../../components/UpgradePrompt";
import { LockedNotice } from "../../../components/LockedNotice";
import { useDraftPhase } from "../../../hooks/useDraftPhase";

export const Route = createFileRoute("/league/$leagueId/keepers")({
  component: KeepersRoute,
});

// The Keepers tab is hidden from the tab bar when a league has turned
// keepers off, but that only keeps someone from clicking into it - this
// catches direct navigation (a bookmarked/typed URL).
//
// Keepers is also Pro-only (see convex/leagues.ts's setUseKeepers) - a
// free-plan visitor gets a non-dismissible upgrade prompt instead of the
// redirect below, since that needs to be seen, not just bounced past. The
// redirect stays for the other case: a Pro owner who turned keepers off on
// purpose for this league.
function KeepersRoute() {
  const { leagueId } = Route.useParams();
  const navigate = useNavigate();
  const settingsList = useQuery(api.leagues.listSeasons, {});
  const settings = settingsList?.find((league) => league._id === leagueId);
  const entitlement = useQuery(api.infinidraft.billing.queries.getMyEntitlement);
  const phase = useDraftPhase(
    leagueId === "new" ? undefined : (leagueId as Id<"seasons">),
  );
  // Absent means true - see schema.ts's useKeepers comment.
  const keepersEnabled = settings?.useKeepers !== false;
  const hasProAccess = entitlement?.hasProAccess ?? false;
  // Matches the "sm" breakpoint route.tsx's Tabs bar appears at
  // (visibleFrom="sm") - see the upgrade Modal's styles below.
  const isDesktop = useMediaQuery("(min-width: 48em)");

  useEffect(() => {
    if (
      leagueId !== "new" &&
      settingsList !== undefined &&
      entitlement !== undefined &&
      hasProAccess &&
      !keepersEnabled
    ) {
      void navigate({
        to: "/league/$leagueId/settings",
        params: { leagueId },
        replace: true,
      });
    }
  }, [
    leagueId,
    settingsList,
    entitlement,
    hasProAccess,
    keepersEnabled,
    navigate,
  ]);

  if (leagueId === "new") {
    return (
      <Text c="dimmed" size="sm">
        Select a league first.
      </Text>
    );
  }

  if (settingsList === undefined || entitlement === undefined) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }

  if (!hasProAccess) {
    return (
      <Modal
        opened
        onClose={() => {}}
        withCloseButton={false}
        closeOnClickOutside={false}
        closeOnEscape={false}
        centered
        // Mantine's Modal overlay defaults to z-index 400 - well above the
        // app's own fixed chrome (AppHeader at 195, BottomNav at 200, the
        // nominate FAB at 210), which would otherwise sit visually and
        // interactively underneath this "can't close it" block, trapping a
        // visitor on the page instead of just blocking the Keepers content
        // itself. 190 keeps it above ordinary page content but below all of
        // that global chrome. AppHeader's own docked bars (MobileStatsRow/
        // UnallocatedBar/PositionFilterBar, all 180-185) are the one
        // exception - a shorter viewport could plausibly have this modal
        // draw over the very bottom of one of those, which is fine, they're
        // not interactive controls the way BottomNav is.
        zIndex={190}
        // On desktop, route.tsx's AppHeader + Tabs bar sit in normal flow
        // above the Outlet (not fixed), so `centered`'s default full-
        // viewport centering could visually collide with the tab bar -
        // especially now that the tab bar outranks this modal's zIndex
        // (200 vs. 190, see route.tsx) so it renders on top of whatever
        // the modal draws underneath it. Biasing the inner container's top
        // padding down (instead of Mantine's symmetric 5dvh) keeps this
        // centered in the content area below the tab bar instead. Mobile
        // has no tab bar to clear (Tabs.List is visibleFrom="sm"), so this
        // only applies at that breakpoint.
        {...(isDesktop ? { styles: { inner: { paddingTop: 160 } } } : {})}
      >
        <UpgradePrompt title="Keepers is a Pro feature" />
      </Modal>
    );
  }

  if (!keepersEnabled) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }

  return (
    <Stack gap="md">
      {phase?.isStarted && (
        <LockedNotice>
          Keeper rules are locked once the draft starts.
        </LockedNotice>
      )}
      <KeepersTab seasonId={leagueId as Id<"seasons">} />
    </Stack>
  );
}
