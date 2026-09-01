import { Box, Group, Popover, Text, ThemeIcon, Tooltip } from "@mantine/core";
import {
  Banknote,
  BanknoteArrowDown,
  BatteryLow,
  CircleSlash,
  Crosshair,
  HandCoins,
  Rocket,
  ShieldCheck,
  TrendingDown,
  TrendingUpDown,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  BAR_HEIGHT,
  ICON_SIZE,
  MAX_BAR_WIDTH,
} from "../../../constants/playersLeft";
import {
  consistencyColor,
  type ConsistencyLabel,
} from "../../../lib/consistency";
import { barStyle, barWidth } from "../../../lib/draftRecommendation";
import type { PlanSlotMatch } from "../../../lib/planRecommendation";
import { playerTagStyle } from "../../../lib/playerTagStyle";
import type { DraftBoardRow, PlayerTag, ValueGap } from "../../../types";
import { RookieBadge } from "@shared/RookieBadge";
import { PlayerBarDetails } from "./PlayerBarDetails";

// Budget-based fade (see budgetOpacity in draftRecommendation.ts) can drop
// a bar's opacity low enough that its name is hard to read - hovering
// raises it back up to at least this floor rather than fully overriding it,
// so a barely-faded bar isn't yanked all the way to opaque while a deeply
// faded one still gets boosted to legible.
const HOVER_OPACITY_FLOOR = 0.85;

// Matches the icon choices PlayerBarDetails.tsx's labeled Badge uses for
// the same consistency ratings - kept in sync there rather than imported,
// same duplication convention as the value-gap icons above (bare ThemeIcon
// here vs. a labeled Badge there).
const CONSISTENCY_ICON: Record<ConsistencyLabel, typeof ShieldCheck> = {
  Reliable: ShieldCheck,
  "Boom/Bust": TrendingUpDown,
  "Low Output": BatteryLow,
};

interface PlayerBarProps {
  row: DraftBoardRow;
  budgetAmount: number | undefined;
  // The single most expensive currently-undrafted player's $ value, across
  // the whole board - see barWidth's comment for how this drives the
  // recalculated px/dollar scale every bar on the page shares.
  highestVisibleDollarValue: number;
  planMatch: PlanSlotMatch | undefined;
  tag: PlayerTag | undefined;
  valueGap: ValueGap | undefined;
  consistency: ConsistencyLabel | undefined;
  isRookie: boolean;
  // True for the one player (across the whole board) currently up for bids -
  // called out with a gold glow + gavel icon so it doesn't get lost among
  // dozens of same-sized bars while the room's attention is on the auction.
  isNominated: boolean;
  // True when *some* player (any row) is currently up for bids - gates the
  // popover's Nominate button, since only one nomination can be active at a
  // time (distinct from isNominated, which is about this one row).
  hasActiveNomination: boolean;
  onSetTag: (tag: PlayerTag) => void;
  onNominate: () => void;
  onSelectPlayer: (fpid: number) => void;
}

// The bar itself only shows name + status icons - clicking it opens a
// Popover with full details/actions (position rank/tier, $ estimate,
// budget fit, value-gap/consistency tags, nominate, target/avoid). Popover
// (rather than the HoverCard this replaced) so the panel persists until an
// outside click/Escape (Mantine's default behavior) instead of vanishing
// the instant the pointer leaves - needed now that it holds real controls
// rather than a read-only preview. Drafted players are filtered out before
// this ever renders (see rowsByPosition in PlayersLeftTab).
export function PlayerBar({
  row,
  budgetAmount,
  highestVisibleDollarValue,
  planMatch,
  tag,
  valueGap,
  consistency,
  isRookie,
  isNominated,
  hasActiveNomination,
  onSetTag,
  onNominate,
  onSelectPlayer,
}: PlayerBarProps) {
  const width = barWidth(row.dollarValue, highestVisibleDollarValue);
  // Bars are narrow (width = projected cost), so most names truncate -
  // rather than a tooltip, smoothly grow the bar itself to its natural
  // content width on hover (and back on hover end) so the full name (and
  // every status icon - there can be up to three: nominated/value-gap/tag)
  // reads in place. Measuring just the name Text's own overflow isn't
  // enough on its own - once there are 2+ icons, the icon row itself can
  // need more room than the icons alone had at rest, and that deficit
  // never shows up in the name's scrollWidth. Instead this renders a second,
  // invisible copy of the exact same content unconstrained (no truncation,
  // width: max-content) purely to measure its true natural width - see
  // measureRef below.
  const measureRef = useRef<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const [expandedWidth, setExpandedWidth] = useState(width);
  useEffect(() => {
    const measured = measureRef.current?.offsetWidth;
    if (measured === undefined) return;
    setExpandedWidth(Math.max(width, measured));
  }, [row.name, isNominated, valueGap, consistency, isRookie, tag, width]);
  const fitsBudget =
    budgetAmount === undefined || row.dollarValue <= budgetAmount;
  const style = barStyle(consistency, row.dollarValue, budgetAmount);
  const ConsistencyIcon = consistency
    ? CONSISTENCY_ICON[consistency]
    : undefined;

  // Shared between the real (visible) bar and the hidden measurement clone
  // below - `truncateName` is the only thing that differs between them: the
  // visible bar truncates until hovered, the hidden clone never does, since
  // its whole purpose is reporting the fully-expanded natural width.
  function renderRow(truncateName: boolean) {
    return (
      <Group
        pl={5}
        h="100%"
        justify="space-between"
        align="center"
        gap="xs"
        wrap="nowrap"
      >
        {/* A sticky element can only stick within its own containing block -
            without this wrapper, that block would be the whole (very wide,
            once expanded/scrolled) Group, letting the name slide right and
            collide with the icons once scrolled far enough. Giving the name
            its own flex-grow:1 box - sized to exactly "everything before the
            icons" at the bar's current width - bounds the sticky area to
            stop right where the icons begin instead. */}
        <Box
          style={{
            flex: 1,
            minWidth: 0,
            height: "100%",
            display: "flex",
            alignItems: "center",
          }}
        >
          <Text
            truncate={truncateName}
            size="xs"
            w="auto"
            style={{
              position: "sticky",
              left: 0,
              zIndex: 1,
              maxWidth: "100%",
              ...(truncateName ? {} : { whiteSpace: "nowrap" }),
            }}
          >
            {row.name}
          </Text>
        </Box>
        <Group gap={3} wrap="nowrap">
          {isRookie && <RookieBadge />}
          {isNominated && (
            <Tooltip label="Currently up for bids" position="top" withArrow>
              <ThemeIcon color="yellow" variant="light">
                <Banknote size={ICON_SIZE} />
              </ThemeIcon>
            </Tooltip>
          )}
          {valueGap?.direction === "undervalued" ? (
            <Tooltip label="Undervalued" position="top" withArrow>
              <ThemeIcon w="content" color="gold" variant="light">
                <HandCoins size={ICON_SIZE} />
              </ThemeIcon>
            </Tooltip>
          ) : valueGap?.direction === "breakout" ? (
            <Tooltip label="Breakout Player" position="top" withArrow>
              <ThemeIcon w="content" color="grape" variant="light">
                <Rocket size={ICON_SIZE} />
              </ThemeIcon>
            </Tooltip>
          ) : valueGap?.direction === "falloff" ? (
            <Tooltip label="Falloff Player" position="top" withArrow>
              <ThemeIcon w="content" color="red" variant="light">
                <TrendingDown size={ICON_SIZE} />
              </ThemeIcon>
            </Tooltip>
          ) : (
            valueGap?.direction === "overvalued" && (
              <Tooltip label="Overvalued" position="top" withArrow>
                <ThemeIcon w="content" color="red" variant="light">
                  <BanknoteArrowDown size={ICON_SIZE} />
                </ThemeIcon>
              </Tooltip>
            )
          )}
          {consistency && ConsistencyIcon && (
            <Tooltip label={consistency} position="top" withArrow>
              <ThemeIcon
                w="content"
                color={consistencyColor(consistency)}
                variant="light"
              >
                <ConsistencyIcon size={ICON_SIZE} />
              </ThemeIcon>
            </Tooltip>
          )}
          {tag && (
            <Tooltip
              label={tag === "target" ? "Target" : "Avoid"}
              position="top"
              withArrow
            >
              <ThemeIcon {...playerTagStyle(tag)}>
                {tag === "target" ? (
                  <Crosshair size={ICON_SIZE} />
                ) : (
                  <CircleSlash size={ICON_SIZE} />
                )}
              </ThemeIcon>
            </Tooltip>
          )}
        </Group>
      </Group>
    );
  }

  return (
    <>
      <Popover withArrow shadow="md" withinPortal>
        <Popover.Dropdown>
          <PlayerBarDetails
            row={row}
            onSelectPlayer={() => onSelectPlayer(row.fpid)}
            planMatch={planMatch}
            budgetAmount={budgetAmount}
            fitsBudget={fitsBudget}
            consistency={consistency}
            valueGap={valueGap}
            isRookie={isRookie}
            tag={tag}
            onSetTag={onSetTag}
            canNominate={!hasActiveNomination}
            onNominate={onNominate}
          />
        </Popover.Dropdown>
        <Popover.Target>
          <Box
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            h={BAR_HEIGHT}
            maw={MAX_BAR_WIDTH}
            w={hovered ? expandedWidth : width}
            pr={3}
            style={{
              // "clip" rather than "hidden" - both clip overflowing content
              // the same way (needed here to hide the pre-hover-catch-up
              // sliver during the width transition), but unlike "hidden",
              // "clip" doesn't establish its own scroll container, so the
              // sticky name inside still sticks to the *page's* horizontally
              // scrolling board instead of (uselessly) to this bar's own
              // non-scrolling box.
              overflow: "clip",
              position: "relative",
              transition: "width 150ms ease, opacity 150ms ease",
              backgroundColor: style.backgroundColor,
              opacity: isNominated
                ? 1
                : hovered
                  ? Math.max(style.opacity, HOVER_OPACITY_FLOOR)
                  : style.opacity,
              outline: style.outline,
              borderRadius: "var(--mantine-radius-lg)",
              outlineOffset: 1.5,
              cursor: "pointer",
              boxShadow: isNominated
                ? "0 0 0 2px var(--mantine-color-yellow-4), 0 0 10px 3px var(--mantine-color-yellow-6)"
                : undefined,
            }}
          >
            {renderRow(!hovered)}
          </Box>
        </Popover.Target>
      </Popover>
      {/* Invisible twin of the bar's content, unconstrained (width:
          max-content, never truncated) purely so its rendered offsetWidth
          tells us exactly how wide the real bar needs to grow on hover -
          see the measurement effect above. position: fixed takes it out of
          document flow entirely so it can't affect the visible layout. */}
      <Box
        ref={measureRef}
        aria-hidden
        pr={3}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          height: BAR_HEIGHT,
          width: "max-content",
          visibility: "hidden",
          pointerEvents: "none",
        }}
      >
        {renderRow(false)}
      </Box>
    </>
  );
}
