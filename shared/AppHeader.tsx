import type { ReactNode } from "react";
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
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronDown, LogOut, Moon, MoreVertical, Sun } from "lucide-react";
import { MOBILE_HEADER_HEIGHT } from "./constants";
import { AppLogo } from "./AppLogo";

interface AppHeaderProps {
  wordmark: "draft" | "faab" | "league";
  // Hides just the league picker + modeSwitchSlot, keeping the overflow
  // menu (extraOverflowItems, theme, sign out) - for a dashboard that has a
  // signed-in user but no "current league" to show either of those for.
  hideLeagueControls?: boolean;
  // Both computed by the caller (each app fetches league data from its own
  // Convex query) - omitted whenever hideLeagueControls is set.
  selectedLeagueLabel?: string | undefined;
  leagueMenuItems?: ReactNode;
  // infinidraft's Setup/Draft Room mode-switch button; omitted elsewhere.
  modeSwitchSlot?: ReactNode;
  // App-specific overflow items rendered before the built-in theme
  // toggle/sign-out (e.g. infinidraft's Billing/Admin/Data links).
  extraOverflowItems?: ReactNode;
  // infinidraft narrows this to make room for modeSwitchSlot on mobile.
  leagueButtonWidth?: { base: number; sm: number };
}

// Shared top bar for infinidraft/infinifaab/infinileague - logo, league
// picker (dropdown content supplied by the caller, since each app fetches
// its league list from a different Convex query and renders its own
// footer action - "New League" vs "Connect League" - and any per-item
// decoration like infinidraft's draft-status badges), an optional
// mode-switch slot, and an overflow menu (app-specific items, then the
// built-in theme toggle + sign out).
//
// Fixed to the top of the viewport on mobile (native-app-style) rather than
// scrolling away with the page - callers must reserve MOBILE_HEADER_HEIGHT
// of top padding on mobile so page content doesn't start out hidden
// underneath it.
export function AppHeader({
  wordmark,
  hideLeagueControls = false,
  selectedLeagueLabel,
  leagueMenuItems,
  modeSwitchSlot,
  extraOverflowItems,
  leagueButtonWidth = { base: 150, sm: 220 },
}: AppHeaderProps) {
  const navigate = useNavigate();
  const { signOut } = useAuthActions();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const isDark = colorScheme === "dark";

  return (
    <Box
      pos={{ base: "fixed", sm: "static" }}
      top={0}
      left={0}
      right={0}
      px={{ base: "md", sm: 0 }}
      py={{ base: 6, sm: "xs" }}
      h={{ base: MOBILE_HEADER_HEIGHT, sm: "auto" }}
      style={{
        // Above modals that must never be covered by the header (e.g.
        // infinidraft's Keepers route non-dismissible upgrade Modal, zIndex
        // 190) but below BottomNav's 200 - AppHeader (top-fixed) and
        // BottomNav (bottom-fixed) never occupy the same pixels on any real
        // viewport, so their relative order doesn't otherwise matter, and
        // keeping AppHeader under BottomNav lets a bottom-sheet Drawer sit
        // in between the two instead of needing to either outrank
        // BottomNav too or physically avoid ever reaching this bar.
        zIndex: 195,
        display: "flex",
        alignItems: "center",
        overflow: "hidden",
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
          <AppLogo wordmark={wordmark} />
        </Link>
        <Group gap="xs" wrap="nowrap" align="center" style={{ flexShrink: 0 }}>
          {!hideLeagueControls && (
            <>
              <Menu position="bottom-end" withArrow offset={8} width={260}>
                <Menu.Target>
                  <Button
                    variant="default"
                    size="sm"
                    w={leagueButtonWidth}
                    justify="space-between"
                    rightSection={<ChevronDown size={16} />}
                  >
                    <Text truncate span>
                      {selectedLeagueLabel ?? "Select league"}
                    </Text>
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>{leagueMenuItems}</Menu.Dropdown>
              </Menu>
              {modeSwitchSlot}
            </>
          )}
          <Menu position="bottom-end" withArrow offset={8}>
            <Menu.Target>
              <ActionIcon variant="default" size={40} aria-label="More options">
                <MoreVertical size={18} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              {extraOverflowItems}
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
                  // auth token actually clears left whatever authenticated
                  // route was still mounted racing the sign-out, so it
                  // could get invalidated mid-flight and throw "must be
                  // signed in" - caught by the root error boundary with no
                  // way back to the sign-in form short of a hard reload.
                  void (async () => {
                    await signOut();
                    // Otherwise the next sign-in (possibly a different
                    // account on this browser) re-renders whatever route
                    // was still in the address bar, which fails an owner
                    // check as "not authorized" if it belonged to whoever
                    // was signed in before.
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
