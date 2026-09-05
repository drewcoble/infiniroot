import { useMemo } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import {
  ActionIcon,
  Box,
  Button,
  Group,
  Menu,
  Text,
  useMantineColorScheme,
} from "@mantine/core";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
// useConvexAuth from convex/react, not @convex-dev/auth/react's - same
// reason as __root.tsx: this one waits for server confirmation of the
// token, not just "we have some token value in local state".
import { useConvexAuth, useQuery } from "convex/react";
import {
  Check,
  ChevronDown,
  LogOut,
  Moon,
  MoreVertical,
  Plus,
  Sun,
} from "lucide-react";
import { api } from "@infinidata/api";
import { MOBILE_HEADER_HEIGHT } from "@shared/constants";
import { groupSeasonsByLeague } from "@shared/leagueGroups";
import type { LinkedSeason } from "../types/season";
import { AppLogo } from "@shared/AppLogo";

// Same shape as infinileague's own AppHeader.tsx (logo, league-switcher
// Menu, "Connect League" item, theme/sign-out overflow), backed by
// listMyAuctionSeasons instead of listLinkedSeasons so an invited team
// member sees the seasons they've been added to, not just ones they own.
export function AppHeader() {
  const navigate = useNavigate();
  const { leagueId } = useParams({ strict: false });
  const { signOut } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();
  const seasonsList: LinkedSeason[] | undefined = useQuery(
    api.leagues.listMyAuctionSeasons,
    isAuthenticated ? {} : "skip",
  );
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const isDark = colorScheme === "dark";

  const selectedLeague = seasonsList?.find((s) => s._id === leagueId);
  const leagueGroups = useMemo(
    () => groupSeasonsByLeague(seasonsList ?? []),
    [seasonsList],
  );

  const handleLeagueChange = (seasonId: string) => {
    void navigate({ to: "/league/$leagueId", params: { leagueId: seasonId } });
  };

  return (
    // Fixed to the top of the viewport on mobile (native-app-style), static
    // on desktop - same pattern as infinidraft/infinileague's AppHeader.tsx,
    // so callers must reserve MOBILE_HEADER_HEIGHT of top padding on mobile
    // (see PageContainer's own pt default) or page content starts out
    // hidden underneath it.
    <Box
      pos={{ base: "fixed", sm: "static" }}
      top={0}
      left={0}
      right={0}
      px={{ base: "md", sm: 0 }}
      py={{ base: 6, sm: "xs" }}
      h={{ base: MOBILE_HEADER_HEIGHT, sm: "auto" }}
      style={{
        zIndex: 195,
        display: "flex",
        alignItems: "center",
        overflow: "hidden",
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
          <AppLogo wordmark="faab" />
        </Link>
        <Group gap="xs" wrap="nowrap" align="center" style={{ flexShrink: 0 }}>
          <Menu position="bottom-end" withArrow offset={8} width={260}>
            <Menu.Target>
              <Button
                variant="default"
                size="sm"
                w={{ base: 150, sm: 220 }}
                justify="space-between"
                rightSection={<ChevronDown size={16} />}
              >
                <Text truncate span>
                  {selectedLeague ? selectedLeague.name : "Select league"}
                </Text>
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              {leagueGroups.map(({ latest, seasons }) => (
                <Menu.Item
                  key={latest.leagueId}
                  leftSection={
                    seasons.some((s) => s._id === leagueId) ? (
                      <Check size={16} />
                    ) : null
                  }
                  onClick={() => handleLeagueChange(latest._id)}
                >
                  {latest.name}
                </Menu.Item>
              ))}
              <Menu.Divider />
              <Menu.Item
                leftSection={<Plus size={16} />}
                onClick={() => void navigate({ to: "/connect-sleeper" })}
              >
                Connect League
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
          <Menu position="bottom-end" withArrow offset={8}>
            <Menu.Target>
              <ActionIcon variant="default" size={40} aria-label="More options">
                <MoreVertical size={18} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                leftSection={isDark ? <Sun size={16} /> : <Moon size={16} />}
                onClick={() => setColorScheme(isDark ? "light" : "dark")}
              >
                {isDark ? "Light mode" : "Dark mode"}
              </Menu.Item>
              <Menu.Item
                leftSection={<LogOut size={16} />}
                onClick={() => {
                  // Awaited, not fire-and-forget - same reasoning as the
                  // other two apps' AppHeader: navigating before the auth
                  // token actually clears can race an authenticated query
                  // still mounted on this page and throw "must be signed
                  // in" instead of landing cleanly on the sign-in form.
                  void (async () => {
                    await signOut();
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
