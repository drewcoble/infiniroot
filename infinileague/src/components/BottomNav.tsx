import { Box, Menu, Stack, Text, UnstyledButton } from "@mantine/core";
import { Link } from "@tanstack/react-router";
import { MoreHorizontal } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { BOTTOM_NAV_BOTTOM_OFFSET, BOTTOM_NAV_HEIGHT } from "../constants/general";

export type BottomNavItem = {
  value: string;
  label: string;
  icon: LucideIcon;
  to: string;
  params: Record<string, string>;
};

type BottomNavMore = {
  label: string;
  items: readonly BottomNavItem[];
};

interface BottomNavProps {
  items: readonly BottomNavItem[];
  activeValue: string | undefined;
  // Overflow menu for tabs beyond the direct row - see route.tsx's own
  // direct/overflow split. Optional so a page with few enough tabs can
  // still render the plain flat row this component started as.
  more?: BottomNavMore;
}

// `to`/`params` are plain strings/a Record on BottomNavItem (items come from
// route.tsx's own TABS, already route-checked at their point of definition),
// not literals, so TanStack Router's Link can't resolve which params shape
// applies to it at this generic call site - same cast infinidraft's
// BottomNav.tsx uses for the same reason.
function linkPropsFor(item: BottomNavItem) {
  return { to: item.to, params: item.params } as { to: "/" };
}

// Mobile-only tab bar, fixed to the bottom of the viewport (hidden at the
// "sm" breakpoint and up, where the top Tabs take over instead) - same
// floating-pill treatment as infinidraft's own BottomNav.tsx, including its
// overflow "More" menu now that infinileague has grown past a handful of
// tabs (Depth Charts pushed it to 6) - minus the FAB notch, which has no
// equivalent here (infinileague has no live-draft nominate action).
// Pairs with the extra bottom padding PageContainer gets in route.tsx so
// this doesn't cover the last bit of scrollable content.
export function BottomNav({ items, activeValue, more }: BottomNavProps) {
  const moreActive = more?.items.some((item) => item.value === activeValue);

  function renderItem(item: BottomNavItem) {
    const Icon = item.icon;
    const active = item.value === activeValue;
    return (
      <Link
        key={item.value}
        {...linkPropsFor(item)}
        style={{ flex: 1, textDecoration: "none", color: "inherit" }}
      >
        <Stack gap={2} align="center" py={12} c={active ? "burlywood" : "dimmed"}>
          <Icon size={20} strokeWidth={active ? 2.5 : 2} />
          <Text fz={10} fw={active ? 600 : 400} lh={1}>
            {item.label}
          </Text>
        </Stack>
      </Link>
    );
  }

  return (
    <Box
      hiddenFrom="sm"
      pos="fixed"
      left={12}
      right={12}
      style={{
        bottom: `calc(${BOTTOM_NAV_BOTTOM_OFFSET}px + env(safe-area-inset-bottom))`,
        height: BOTTOM_NAV_HEIGHT,
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        maxWidth: 480,
        margin: "0 auto",
        borderRadius: "var(--mantine-radius-xl)",
        border: "1px solid var(--mantine-color-default-border)",
        // Same dark-mode "pops off the page" blend infinidraft's BottomNav
        // uses (dark-5, one shade lighter than Card/Popover's dark-6
        // surface) instead of blending into the body - light mode unchanged.
        background:
          "light-dark(color-mix(in srgb, var(--mantine-color-body) 65%, transparent), color-mix(in srgb, var(--mantine-color-dark-5) 50%, transparent))",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        boxShadow: "var(--mantine-shadow-lg)",
        overflow: "hidden",
      }}
    >
      {items.map(renderItem)}
      {more && (
        <Menu position="top-end" withArrow offset={8} width={180}>
          <Menu.Target>
            <UnstyledButton style={{ flex: 1 }}>
              <Stack gap={2} align="center" py={12} c={moreActive ? "burlywood" : "dimmed"}>
                <MoreHorizontal size={20} strokeWidth={moreActive ? 2.5 : 2} />
                <Text fz={10} fw={moreActive ? 600 : 400} lh={1}>
                  {more.label}
                </Text>
              </Stack>
            </UnstyledButton>
          </Menu.Target>
          <Menu.Dropdown>
            {more.items.map((item) => {
              const Icon = item.icon;
              const active = item.value === activeValue;
              return (
                <Menu.Item
                  key={item.value}
                  component={Link}
                  {...linkPropsFor(item)}
                  leftSection={<Icon size={16} />}
                  fw={active ? 600 : 400}
                  c={active ? "burlywood" : "dimmed"}
                >
                  {item.label}
                </Menu.Item>
              );
            })}
          </Menu.Dropdown>
        </Menu>
      )}
    </Box>
  );
}
