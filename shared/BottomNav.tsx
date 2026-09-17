import { Box, Menu, Stack, Text, UnstyledButton } from "@mantine/core";
import { Link } from "@tanstack/react-router";
import { ExternalLink, MoreHorizontal } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { BOTTOM_NAV_BOTTOM_OFFSET, BOTTOM_NAV_HEIGHT } from "./constants";

export type BottomNavItem = {
  value: string;
  label: string;
  icon: LucideIcon;
  to: string;
  params: Record<string, string>;
  // Global/account items never set this - only league-scoped pages that
  // live outside an app's own tab navigation (e.g. infinidraft's TV
  // Board/Report Card) open in a new tab, flagged here so the "More" menu
  // can add the target and the trailing external-link icon rather than
  // every caller remembering to do both.
  external?: boolean;
};

type BottomNavMore = {
  label: string;
  items: readonly BottomNavItem[];
};

interface BottomNavProps {
  items: readonly BottomNavItem[];
  activeValue: string | undefined;
  more?: BottomNavMore;
  // Reserves the center notch for infinidraft's nominate FAB (see
  // MobileNomination) - only shown once a draft has started, so the other
  // apps (which never set this) render one flat evenly-spaced row instead
  // of splitting around an empty gap.
  hasFab?: boolean;
}

// `to`/`params` are plain strings/a Record on BottomNavItem (items come from
// each app's own already route-checked TABS array), not literals, so
// TanStack Router's Link can't resolve which params shape applies to it at
// this generic call site - the route paths themselves are still
// type-checked at their point of definition via the equivalent desktop
// Tabs.Tab renderRoot Link usage in each app's route files.
function linkPropsFor(item: BottomNavItem) {
  return { to: item.to, params: item.params } as { to: "/" };
}

// Width of the empty center notch reserved for infinidraft's nominate FAB
// (a fixed 56px circle centered on the same axis) - wide enough that the
// FAB's shadow/border doesn't crowd the flanking buttons.
const FAB_GAP_WIDTH = 72;

// Mobile-only tab bar, fixed to the bottom of the viewport (hidden at the
// "sm" breakpoint and up, where the top Tabs take over instead). Floats
// above the bottom edge as a rounded, elevated bar rather than sitting
// flush with the screen. Pairs with the extra bottom padding added to the
// page Container in the layout routes that use it so this doesn't cover
// the last bit of scrollable content.
//
// When `hasFab` is set, renders as two flex groups with an empty gap
// between them (rather than one flat row) so a nominate FAB - fixed-
// positioned and horizontally centered independently - has a dedicated
// notch to float in instead of landing on top of whichever button happened
// to sit in the dead center of an evenly-spaced row.
export function BottomNav({
  items,
  activeValue,
  more,
  hasFab = false,
}: BottomNavProps) {
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
        <Stack
          gap={2}
          align="center"
          py={12}
          c={active ? "burlywood" : "dimmed"}
        >
          <Icon size={20} strokeWidth={active ? 2.5 : 2} />
          <Text fz={10} fw={active ? 600 : 400} lh={1}>
            {item.label}
          </Text>
        </Stack>
      </Link>
    );
  }

  const moreButton = more && (
    <Menu key="more" position="top-end" withArrow offset={8} width={180}>
      <Menu.Target>
        <UnstyledButton style={{ flex: 1 }}>
          <Stack
            gap={2}
            align="center"
            py={12}
            c={moreActive ? "burlywood" : "dimmed"}
          >
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
              {...(item.external ? { target: "_blank" as const } : {})}
              leftSection={<Icon size={16} />}
              rightSection={
                item.external ? <ExternalLink size={14} /> : undefined
              }
              fw={active ? 600 : 400}
              c={active ? "burlywood" : "dimmed"}
            >
              {item.label}
            </Menu.Item>
          );
        })}
      </Menu.Dropdown>
    </Menu>
  );

  const buttons = [...items.map(renderItem), moreButton];
  const leftButtons = hasFab
    ? buttons.slice(0, Math.ceil(buttons.length / 2))
    : buttons;
  const rightButtons = hasFab
    ? buttons.slice(Math.ceil(buttons.length / 2))
    : [];

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
        // Dark mode: dark-5, one shade lighter than the dark-green
        // "surface" color Card/Popover use (--mantine-color-dark-6, see
        // theme.ts's dark: [...] array) and the even-darker body color, so
        // the floating bar visibly pops off the page instead of blending
        // into it - then translucent (same as before) so backdropFilter's
        // blur of whatever's scrolling underneath still reads as frosted
        // glass, not a flat cutout. Light mode is unchanged, still keyed
        // off body.
        background:
          "light-dark(color-mix(in srgb, var(--mantine-color-body) 65%, transparent), color-mix(in srgb, var(--mantine-color-dark-5) 50%, transparent))",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        boxShadow: "var(--mantine-shadow-lg)",
        overflow: "hidden",
      }}
    >
      {leftButtons}
      {hasFab && <Box style={{ width: FAB_GAP_WIDTH, flexShrink: 0 }} />}
      {rightButtons}
    </Box>
  );
}
