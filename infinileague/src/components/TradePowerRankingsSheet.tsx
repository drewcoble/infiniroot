import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Box, Drawer, Group, Stack, Text, Title } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { ChevronUp } from "lucide-react";
import { RankChangeIndicator } from "./PowerRankingsList";
import { TradePowerRankingsList } from "./TradePowerRankingsList";
import { BOTTOM_NAV_BOTTOM_OFFSET, BOTTOM_NAV_HEIGHT } from "../constants/general";
import type { PowerRankingRow } from "../types/season";

// Same overlap-BottomNav-by-its-own-corner-radius trick infinidraft's
// DraftRoom/components/MobileNomination.tsx uses for its peek card - the
// card sits just BELOW BottomNav in z-index, extending up into its territory
// by exactly BottomNav's own xl radius so its rounded top corners' gap gets
// filled by this card's matching background instead of floating a seam
// above it. See that file's own comment for the full reasoning.
const PEEK_BOTTOM_OFFSET = `calc(${BOTTOM_NAV_BOTTOM_OFFSET}px + ${BOTTOM_NAV_HEIGHT}px - var(--mantine-radius-xl) + env(safe-area-inset-bottom))`;
const PEEK_BOTTOM_PADDING = "calc(var(--mantine-radius-xl) + 6px)";
const DRAWER_MAX_HEIGHT = "90vh";
const DRAWER_CONTENT_BOTTOM_PADDING = `calc(var(--mantine-spacing-md) + ${BOTTOM_NAV_BOTTOM_OFFSET}px + ${BOTTOM_NAV_HEIGHT}px + env(safe-area-inset-bottom))`;

// Generous estimate of the peek card's own rendered height (two text lines
// + padding) - trade.tsx renders a matching spacer of this height so the
// card (fixed/portaled, outside document flow) doesn't cover the last bit
// of real page content when scrolled to the bottom on mobile.
export const TRADE_PEEK_CARD_HEIGHT = 92;

// How far down the drag handle has to travel before release counts as a
// swipe-to-dismiss rather than a tap or an aborted drag.
const DRAG_DISMISS_THRESHOLD = 80;

// Ported from infinidraft's DraftRoom/components/mobileDraftSheet.tsx (see
// its own comment) - lets the small handle bar at the top of the Drawer
// double as a swipe-down-to-dismiss target, the native bottom-sheet
// convention. `dragY` tracks the pointer 1:1 (for the content below to
// visually follow the finger) and past DRAG_DISMISS_THRESHOLD on release,
// `onDismiss` fires - same as tapping the scrim or pressing Escape.
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

interface TradePowerRankingsSheetProps {
  leagueId: string;
  // Already the "after" list, ranked - see TradePowerRankingsList's own
  // props comment.
  rows: PowerRankingRow[];
  beforeRankByTeam: Map<string, number>;
  // This team's real, current (pre-trade) totalProjectedPoints - diffed
  // against its post-trade value below for the peek card's own "+/- pts"
  // line, which TradePowerRankingsList's full-list view doesn't show (rank
  // movement already covers that view; the peek card's whole point is
  // fitting the two most decision-relevant numbers into two lines without
  // opening the drawer).
  beforePointsByTeam: Map<string, number>;
  teamAId: string;
  teamBId: string;
  teamAName: string;
  teamBName: string;
}

// Mobile-only peek card + bottom Drawer for the post-trade power rankings
// preview (see trade.tsx) - same pattern infinidraft's DraftRoom/components/
// MobileNomination.tsx and mobileDraftSheet.tsx use for the draft room's
// nomination sheet, minus the FAB (infinileague has no live-draft nominate
// action to hang one off of - the peek card alone is the only entry point
// here). Desktop keeps the plain inline Card in trade.tsx instead
// (visibleFrom="sm" there) - scrolling to it isn't the problem this solves,
// only mobile's much taller stacked layout pushing it below the fold is.
export function TradePowerRankingsSheet({
  leagueId,
  rows,
  beforeRankByTeam,
  beforePointsByTeam,
  teamAId,
  teamBId,
  teamAName,
  teamBName,
}: TradePowerRankingsSheetProps) {
  const [open, setOpen] = useState(false);
  // Same "don't actually let Mantine's Drawer open on desktop" guard
  // mobileDraftSheet.tsx's BottomSheet uses - hiddenFrom="sm" below is
  // CSS-only, so without this the Drawer's body-scroll-lock/focus-trap
  // would still fire on desktop whenever `open` happens to be true.
  const isDesktop = useMediaQuery("(min-width: 48em)");
  const { dragY, dragHandleProps } = useSwipeToDismiss(() => setOpen(false));

  const afterByTeam = new Map(
    rows.map((row, index) => [row.teamId, { rank: index + 1, points: row.totalProjectedPoints }]),
  );
  const peekTeams = [
    { teamId: teamAId, name: teamAName },
    { teamId: teamBId, name: teamBName },
  ];

  return (
    <>
      {createPortal(
        <Box
          hiddenFrom="sm"
          pos="fixed"
          left={12}
          right={12}
          role="button"
          tabIndex={0}
          aria-label="View full post-trade power rankings"
          onClick={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") setOpen(true);
          }}
          style={{
            bottom: PEEK_BOTTOM_OFFSET,
            // Below BottomNav's own 200 - see PEEK_BOTTOM_OFFSET's comment
            // for why that's what makes the overlap look intentional.
            zIndex: 195,
            maxWidth: 480,
            margin: "0 auto",
            padding: `10px 14px ${PEEK_BOTTOM_PADDING}`,
            borderTopLeftRadius: "var(--mantine-radius-xl)",
            borderTopRightRadius: "var(--mantine-radius-xl)",
            borderLeft: "1px solid var(--mantine-color-default-border)",
            borderRight: "1px solid var(--mantine-color-default-border)",
            borderTop: "1px solid var(--mantine-color-default-border)",
            // Same background as BottomNav.tsx so the two are indistinguishable
            // at the shared edge.
            background:
              "light-dark(color-mix(in srgb, var(--mantine-color-body) 65%, transparent), color-mix(in srgb, var(--mantine-color-dark-5) 50%, transparent))",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            cursor: "pointer",
          }}
        >
          <Group gap={8} wrap="nowrap" align="center">
            <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
              {peekTeams.map(({ teamId, name }) => {
                const beforeRank = beforeRankByTeam.get(teamId);
                const beforePoints = beforePointsByTeam.get(teamId);
                const after = afterByTeam.get(teamId);
                const rankChange =
                  beforeRank !== undefined && after !== undefined
                    ? beforeRank - after.rank
                    : undefined;
                const pointsDiff =
                  beforePoints !== undefined && after !== undefined
                    ? after.points - beforePoints
                    : undefined;
                return (
                  <Group key={teamId} gap={6} wrap="nowrap" justify="space-between">
                    <Group gap={6} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
                      <RankChangeIndicator rankChange={rankChange} />
                      <Text size="sm" fw={500} truncate>
                        {name}
                      </Text>
                    </Group>
                    {pointsDiff !== undefined && (
                      <Text
                        size="sm"
                        fw={500}
                        c={pointsDiff > 0 ? "green" : pointsDiff < 0 ? "red" : "dimmed"}
                        style={{ flexShrink: 0 }}
                      >
                        {pointsDiff >= 0 ? "+" : ""}
                        {pointsDiff.toFixed(1)} pts
                      </Text>
                    )}
                  </Group>
                );
              })}
            </Stack>
            {/* Same trailing chevron infinidraft's SearchPeekCard/
                AssignPeekCard use - the visual cue that tapping this card
                expands it upward into the full drawer. */}
            <ChevronUp size={16} color="var(--mantine-color-dimmed)" style={{ flexShrink: 0 }} />
          </Group>
        </Box>,
        document.body,
      )}

      <Drawer
        hiddenFrom="sm"
        opened={open && !isDesktop}
        onClose={() => setOpen(false)}
        position="bottom"
        withCloseButton={false}
        size="auto"
        // Below BottomNav's own 200, above AppHeader's own 195 - same stack
        // mobileDraftSheet.tsx's BottomSheet uses.
        zIndex={197}
        overlayProps={{ blur: 2 }}
        styles={{
          content: {
            maxWidth: 480,
            maxHeight: DRAWER_MAX_HEIGHT,
            margin: "0 auto",
            background: "transparent",
            boxShadow: "none",
          },
          body: { height: "100%", padding: 0, display: "flex", flexDirection: "column" },
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
            borderTopLeftRadius: "var(--mantine-radius-xl)",
            borderTopRightRadius: "var(--mantine-radius-xl)",
            overflow: "hidden",
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
            <Title order={5} mb="xs">
              Post-trade power rankings
            </Title>
            <TradePowerRankingsList
              leagueId={leagueId}
              rows={rows}
              beforeRankByTeam={beforeRankByTeam}
              beforePointsByTeam={beforePointsByTeam}
              highlightedTeamIds={new Set([teamAId, teamBId])}
            />
          </div>
        </div>
      </Drawer>
    </>
  );
}
