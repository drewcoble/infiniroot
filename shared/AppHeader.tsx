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
import {
  ChevronDown,
  LogOut,
  Moon,
  MoreHorizontal,
  MoreVertical,
  Sun,
} from "lucide-react";
import { MOBILE_HEADER_HEIGHT } from "./constants";
import { AppLogo } from "./AppLogo";
import { glassClasses, glassMenuProps } from "./glassClasses";

interface AppHeaderProps {
  wordmark: "draft" | "faab" | "league";
  // Hides just the league picker + modeSwitchSlot, keeping the overflow
  // menu - for a dashboard that has a
  // signed-in user but no "current league" to show either of those for.
  hideLeagueControls?: boolean;
  // Both computed by the caller (each app fetches league data from its own
  // Convex query) - omitted whenever hideLeagueControls is set.
  selectedLeagueLabel?: string | undefined;
  leagueMenuItems?: ReactNode;
  // infinidraft's Setup/Draft Room mode-switch button; omitted elsewhere.
  modeSwitchSlot?: ReactNode;
  // App-specific overflow items, one slot per labeled group: NFL-wide
  // reference pages (Depth Charts, Injuries), super-admin tools, and
  // account items (e.g. infinidraft's Billing), which the built-in theme
  // toggle/sign-out are appended to. Pass a falsy value for a group with
  // nothing to show (e.g. admin for a non-admin) and it's omitted, label,
  // divider and all.
  nflMenuItems?: ReactNode;
  adminMenuItems?: ReactNode;
  userMenuItems?: ReactNode;
  // infinidraft narrows this to make room for modeSwitchSlot on mobile.
  leagueButtonWidth?: { base: number; sm: number };
  // Glass chrome (see glass.module.css): no bar at all - the logo, league
  // switcher, and overflow button each float as their own glass piece over
  // the page, with glass dropdown menus. infinileague opts in; other apps
  // keep the frosted full-width bar.
  glass?: boolean;
}

// Header row height on mobile when `glass` - plus its top offset, it takes
// up the same MOBILE_HEADER_HEIGHT footprint the flat bar does, so page
// padding (PageContainer) and anything docked below needn't change. Tall
// enough for the logo's panel (emblem + stacked wordmark).
const GLASS_HEADER_TOP = 2;
const GLASS_HEADER_HEIGHT = MOBILE_HEADER_HEIGHT - GLASS_HEADER_TOP;

// Shared top bar for infinidraft/infinifaab/infinileague - logo, league
// picker (dropdown content supplied by the caller, since each app fetches
// its league list from a different Convex query and renders its own
// footer action - "New League" vs "Connect League" - and any per-item
// decoration like infinidraft's draft-status badges), an optional
// mode-switch slot, and an overflow menu (NFL/Admin/User groups - the User
// group always ends with the built-in theme toggle + sign out).
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
  nflMenuItems,
  adminMenuItems,
  userMenuItems,
  leagueButtonWidth = { base: 150, sm: 220 },
  glass = false,
}: AppHeaderProps) {
  const navigate = useNavigate();
  const { signOut } = useAuthActions();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const isDark = colorScheme === "dark";
  const menuProps = glass ? glassMenuProps : { withArrow: true };

  return (
    <Box
      pos={{ base: "fixed", sm: "static" }}
      {...(glass
        ? {
            top: {
              base: `calc(${GLASS_HEADER_TOP}px + env(safe-area-inset-top))`,
              sm: 0,
            },
            left: { base: 12, sm: 0 },
            right: { base: 12, sm: 0 },
            py: { base: 0, sm: "xs" },
            h: { base: GLASS_HEADER_HEIGHT, sm: "auto" },
            style: {
              zIndex: 195,
              display: "flex",
              alignItems: "center",
              // Lined up with the bottom nav's width cap.
              maxWidth: 480,
              marginInline: "auto",
              // The row itself is invisible - taps in the gaps between the
              // pieces fall through to the page; the pieces opt back in.
              pointerEvents: "none",
            },
          }
        : {
            top: 0,
            left: 0,
            right: 0,
            px: { base: "md", sm: 0 },
            py: { base: 6, sm: "xs" },
            h: { base: MOBILE_HEADER_HEIGHT, sm: "auto" },
            style: {
              zIndex: 195,
              display: "flex",
              alignItems: "center",
              overflow: "hidden",
              background:
                "color-mix(in srgb, var(--mantine-color-body) 75%, transparent)",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              borderBottom: "1px solid var(--mantine-color-default-border)",
            },
          })}
    >
      <Group
        justify="space-between"
        align="center"
        wrap="nowrap"
        gap="xs"
        style={{ flex: 1, minWidth: 0 }}
      >
        <Link
          to="/"
          {...(glass ? { className: glassClasses.logoPanel } : {})}
          style={{
            flexShrink: 0,
            textDecoration: "none",
            ...(glass ? { pointerEvents: "auto" } : {}),
          }}
        >
          <AppLogo wordmark={wordmark} />
        </Link>
        <Group
          {...(glass ? { className: glassClasses.controls } : {})}
          gap="xs"
          wrap="nowrap"
          align="center"
          style={{
            flexShrink: 0,
            ...(glass ? { pointerEvents: "auto" } : {}),
          }}
        >
          {!hideLeagueControls && (
            <>
              <Menu position="bottom-end" offset={8} width={260} {...menuProps}>
                <Menu.Target>
                  {glass ? (
                    <Box
                      component="button"
                      type="button"
                      className={glassClasses.button}
                      w={leagueButtonWidth}
                    >
                      <span className={glassClasses.buttonLabel}>
                        {selectedLeagueLabel ?? "Select league"}
                      </span>
                      <ChevronDown size={16} style={{ flexShrink: 0 }} />
                    </Box>
                  ) : (
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
                  )}
                </Menu.Target>
                <Menu.Dropdown>{leagueMenuItems}</Menu.Dropdown>
              </Menu>
              {modeSwitchSlot}
            </>
          )}
          <Menu position="bottom-end" offset={8} {...menuProps}>
            <Menu.Target>
              {glass ? (
                <button
                  type="button"
                  className={glassClasses.iconButton}
                  aria-label="More options"
                >
                  <MoreHorizontal size={18} strokeWidth={2.5} />
                </button>
              ) : (
                <ActionIcon
                  variant="default"
                  size={40}
                  aria-label="More options"
                >
                  <MoreVertical size={18} />
                </ActionIcon>
              )}
            </Menu.Target>
            <Menu.Dropdown>
              {nflMenuItems && (
                <>
                  <Menu.Label>NFL</Menu.Label>
                  {nflMenuItems}
                  <Menu.Divider />
                </>
              )}
              {adminMenuItems && (
                <>
                  <Menu.Label>Admin</Menu.Label>
                  {adminMenuItems}
                  <Menu.Divider />
                </>
              )}
              <Menu.Label>User</Menu.Label>
              {userMenuItems}
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
