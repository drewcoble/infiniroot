import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { ActionIcon, Box, Button, Drawer, Group } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import type { Id } from "@infinidata/dataModel";
import {
  BOTTOM_NAV_BOTTOM_OFFSET,
  BOTTOM_NAV_HEIGHT,
} from "../../../constants/general";

// Shared chrome for the two mobile draft bottom sheets - auction's
// MobileNomination (nominate/bid/assign) and snake/linear's
// MobileSnakeDraft (pick a player). Both hang a FAB in BottomNav's center
// notch and drive a single swipe-dismissable bottom Drawer from it, so the
// FAB geometry, drawer z-index/blur treatment, drag-to-dismiss behavior,
// and team-chip row all live here once rather than being kept in sync by
// hand across two ~1000-line components.

// The FAB's own circle size.
const DRAFT_FAB_SIZE = 56;

// Bottom padding reserved inside the Drawer's own scrollable content - its
// background runs all the way to the screen's bottom edge (behind
// BottomNav, which stays reachable via its own higher z-index), but nothing
// scrollable should actually render underneath BottomNav's real tappable
// area, so the content stops that much earlier than its background does.
const DRAWER_CONTENT_BOTTOM_PADDING = `calc(var(--mantine-spacing-md) + ${BOTTOM_NAV_BOTTOM_OFFSET}px + ${BOTTOM_NAV_HEIGHT}px + env(safe-area-inset-bottom))`;

// Caps how tall the Drawer can grow (see BottomSheet's own size="auto"
// comment for why a cap is what actually controls its rendered height) -
// generous enough for the tallest body while leaving a sliver of the page
// visible/scrollable above it on tall viewports.
const DRAWER_MAX_HEIGHT = "90vh";

// How far down the drag handle has to travel before release counts as a
// swipe-to-dismiss rather than a tap or an aborted drag.
const DRAG_DISMISS_THRESHOLD = 80;

// Lets the small handle bar at the top of the Drawer double as a
// swipe-down-to-dismiss target, the native bottom-sheet convention. `dragY`
// tracks the pointer 1:1 (for the content below to visually follow the
// finger) and past DRAG_DISMISS_THRESHOLD on release, `onDismiss` fires -
// same as tapping the scrim or pressing Escape.
function useSwipeToDismiss(onDismiss: () => void) {
  const [dragY, setDragY] = useState(0);
  const draggingRef = useRef(false);
  const startYRef = useRef(0);

  const endDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (dragY > DRAG_DISMISS_THRESHOLD) onDismiss();
    setDragY(0);
  };

  return {
    dragY,
    dragHandleProps: {
      onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
        draggingRef.current = true;
        startYRef.current = event.clientY;
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!draggingRef.current) return;
        setDragY(Math.max(0, event.clientY - startYRef.current));
      },
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
  };
}

interface DraftFabProps {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}

// The circular action button sitting in BottomNav's center notch. Height-
// matched to BottomNav's own pill (BOTTOM_NAV_HEIGHT) and flex-centered,
// rather than just sharing its bottom offset, so the circle's vertical
// center always lines up with the bar's regardless of small differences
// between the two elements' natural heights - see BOTTOM_NAV_HEIGHT's own
// comment.
//
// Portaled straight to document.body rather than rendered inline - this is
// a pos="fixed" element (not one of Mantine's own Portal-backed overlays
// like Drawer/Modal, which already escape their ancestry by default), so
// wherever its caller happens to be mounted in the tree - the auction
// sidebar's Group column, some future wrapper, whatever - it always
// resolves `bottom`/`left` against the viewport instead of a positioned/
// transformed/filtered ancestor. Route.tsx's BottomNav hit exactly this
// (a Group ancestor made it float mid-page on WebKit/iOS instead of
// pinning to the bottom); portaling here fixes it at the source instead of
// relying on every caller to remember not to nest it under one.
export function DraftFab({ icon, label, onClick }: DraftFabProps) {
  return createPortal(
    <Box
      hiddenFrom="sm"
      pos="fixed"
      left="50%"
      style={{
        bottom: `calc(${BOTTOM_NAV_BOTTOM_OFFSET}px + env(safe-area-inset-bottom))`,
        height: BOTTOM_NAV_HEIGHT,
        display: "flex",
        alignItems: "center",
        transform: "translateX(-50%)",
        zIndex: 210,
      }}
    >
      <ActionIcon
        radius="xl"
        size={DRAFT_FAB_SIZE}
        color="saddlebrown"
        variant="filled"
        aria-label={label}
        onClick={onClick}
        style={{
          boxShadow: "var(--mantine-shadow-lg)",
          border: "none",
          // A saddlebrown gradient (lighter shade 3 to darker shade 7)
          // instead of a flat fill, each stop still mixed with transparent
          // at the same 65% so it stays translucent against the frosted bar
          // underneath it (see BottomNav.tsx).
          background:
            "linear-gradient(135deg, color-mix(in srgb, var(--mantine-color-saddlebrown-3) 65%, transparent), color-mix(in srgb, var(--mantine-color-saddlebrown-7) 65%, transparent))",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
        }}
      >
        {icon}
      </ActionIcon>
    </Box>,
    document.body,
  );
}

interface BottomSheetProps {
  opened: boolean;
  onDismiss: () => void;
  children: ReactNode;
}

// The swipe-dismissable bottom Drawer both mobile draft sheets render into.
export function BottomSheet({ opened, onDismiss, children }: BottomSheetProps) {
  const { dragY, dragHandleProps } = useSwipeToDismiss(onDismiss);
  // hiddenFrom="sm" below only hides the Drawer visually - Mantine's Modal/
  // Drawer internals (body scroll lock, focus trap) still run whenever
  // `opened` is true regardless of that CSS class, which would lock page
  // scroll on desktop the whole time a sheet is "open" even though it's
  // never actually shown there. Gating `opened` itself on the same
  // breakpoint (matches route.tsx's Tabs visibleFrom="sm") keeps the Drawer
  // from ever truly opening on desktop.
  const isDesktop = useMediaQuery("(min-width: 48em)");

  return (
    <Drawer
      hiddenFrom="sm"
      opened={opened && !isDesktop}
      onClose={onDismiss}
      position="bottom"
      withCloseButton={false}
      // "auto" rather than a fixed fraction of the screen (e.g. "50%") -
      // Mantine's Drawer always renders at its styles.content maxHeight cap
      // regardless of the size prop (its internal scroll wrapper forces
      // near-viewport height, which "auto" then sizes to), so this and the
      // maxHeight below together give a tall-enough, capped sheet no matter
      // which body is showing.
      size="auto"
      // Below BottomNav's own 200 (and the FAB's 210) - so the nav bar, and
      // the FAB sitting in its notch, render on top of both the sheet and
      // its scrim instead of being covered by them, keeping in-app
      // navigation reachable while the sheet's open (the sheet's own
      // background runs behind BottomNav all the way to the screen's bottom
      // edge - see DRAWER_CONTENT_BOTTOM_PADDING for why its content
      // doesn't - so this is what keeps BottomNav paintable on top of that
      // background too). Above AppHeader's own 195 (see its zIndex comment)
      // so a tall sheet draws in front of the fixed header/stats-row instead
      // of behind them, without needing BottomNav to outrank those bars too.
      zIndex={197}
      // A slight blur on the scrim itself (not just the sheet's own
      // background), matching the frosted-glass treatment used everywhere
      // else in the app (BottomNav.tsx, AppHeader.tsx) - the rest of the
      // page behind it reads as softened, not just dimmed.
      overlayProps={{ blur: 2 }}
      styles={{
        // Left visually bare (no background/radius/shadow of its own) - see
        // the draggable div just below for why: Mantine's own open/close
        // Transition sets this exact node's `transform` on every render
        // (even once "entered"), so our own drag transform can't live here
        // without the two fighting each other every frame.
        content: {
          maxWidth: 480,
          maxHeight: DRAWER_MAX_HEIGHT,
          margin: "0 auto",
          background: "transparent",
          boxShadow: "none",
        },
        body: {
          height: "100%",
          padding: 0,
          display: "flex",
          flexDirection: "column",
        },
      }}
    >
      {/* Owns the sheet's actual background/radius/blur (not Content above)
          specifically so dragging moves the whole visible card - chrome
          included - together with the finger, rather than just the handle/
          content sliding inside a background that stays put. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
          borderTopLeftRadius: "var(--mantine-radius-xl)",
          borderTopRightRadius: "var(--mantine-radius-xl)",
          overflow: "hidden",
          // The "surface" shade Card/Popover use (dark-6 - see BottomNav's
          // own comment on dark-5 vs dark-6) rather than BottomNav's lighter
          // dark-5, and noticeably less transparent than BottomNav's own
          // 65%/50% - a full sheet reading through to the page behind it
          // looks murky over this much area, where BottomNav's translucency
          // works at its own much smaller size.
          background:
            "light-dark(color-mix(in srgb, var(--mantine-color-body) 85%, transparent), color-mix(in srgb, var(--mantine-color-dark-6) 85%, transparent))",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          transform: `translateY(${dragY}px)`,
          transition: dragY === 0 ? "transform 200ms ease" : "none",
        }}
      >
        <div
          {...dragHandleProps}
          aria-hidden
          style={{
            display: "flex",
            justifyContent: "center",
            padding: "10px 0 6px",
            flexShrink: 0,
            touchAction: "none",
            cursor: "grab",
          }}
        >
          <div
            style={{
              width: 36,
              height: 4,
              borderRadius: 999,
              background: "var(--mantine-color-default-border)",
            }}
          />
        </div>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: `0 var(--mantine-spacing-md) ${DRAWER_CONTENT_BOTTOM_PADDING}`,
          }}
        >
          {children}
        </div>
      </div>
    </Drawer>
  );
}

interface TeamChipRowProps {
  teams: { id: Id<"seasonTeams"> | null; label: string }[];
  selectedId: Id<"seasonTeams"> | null;
  onSelect: (id: Id<"seasonTeams"> | null) => void;
}

// Wrapping row of team pills - tap a team directly rather than stepping
// through them or picking from a dropdown. Shared by auction's nominating/
// winning-team selectors and snake's "picking as" selector.
export function TeamChipRow({ teams, selectedId, onSelect }: TeamChipRowProps) {
  return (
    <Group gap={8} wrap="wrap">
      {teams.map((team) => {
        const active = team.id === selectedId;
        return (
          <Button
            key={team.id ?? "__manual__"}
            size="xs"
            radius="xl"
            variant={active ? "filled" : "default"}
            {...(active ? { color: "saddlebrown" } : {})}
            onClick={() => onSelect(team.id)}
          >
            {team.label}
          </Button>
        );
      })}
    </Group>
  );
}
