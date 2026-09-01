import {
  Anchor,
  Badge,
  Box,
  Button,
  Group,
  Stack,
  Text,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
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
import { ICON_SIZE } from "../../../constants/playersLeft";
import {
  consistencyColor,
  type ConsistencyLabel,
} from "../../../lib/consistency";
import { injuryColor } from "@shared/injuryColor";
import { POSITION_COLORS } from "@shared/positionColors";
import type { StandardValueRow } from "../../../lib/standardValues";
import type { DraftBoardRow, PlayerTag, ValueGap } from "../../../types";
import { RookieBadge } from "@shared/RookieBadge";
import { StandardValueLabel } from "../../../components/StandardValueLabel";
import { formatSignedNumber, keeperValueColor } from "../../../lib/keeperValue";
import { useSwipeReveal } from "../../../hooks/useSwipeReveal";

// Same icon choices PlayerTableRow.tsx/PlayerBar.tsx use for the same
// consistency ratings - kept in sync there rather than imported, same
// duplication convention those already share.
const CONSISTENCY_ICON: Record<ConsistencyLabel, typeof ShieldCheck> = {
  Reliable: ShieldCheck,
  "Boom/Bust": TrendingUpDown,
  "Low Output": BatteryLow,
};

// Width of the Target/Avoid action strip a row reveals when swiped left -
// the row's own content slides left by exactly this much to expose it.
const ACTIONS_WIDTH = 192;

interface PlayerTableRowMobileProps {
  row: DraftBoardRow;
  tag: PlayerTag | undefined;
  standardValue: StandardValueRow | undefined;
  // Auction: $ / vs. market (standardValue above). Snake/linear: ADP / vs
  // ADP (adp/ourRank below) - same isAuction branch PlayerRowMobile.tsx
  // (the pre-draft table's mobile row) already uses.
  isAuction: boolean;
  adp: number | undefined;
  ourRank: number | undefined;
  valueGap: ValueGap | undefined;
  consistency: ConsistencyLabel | undefined;
  injury: { status: string; statusShort: string } | undefined;
  isRookie: boolean;
  isNominated: boolean;
  // Only one row is ever swiped open at a time - PlayersLeftTab.tsx owns
  // that single fpid rather than each row tracking its own.
  isSwiped: boolean;
  onSwipeOpen: () => void;
  onSetTag: (tag: PlayerTag) => void;
  // Tapping the row's own content (not the name, not the swiped-open
  // actions) only ever closes a swiped-open row - it doesn't open player
  // details itself, since that touch target used to cover the whole row
  // and made it too easy to open a modal by accident. Only the name text
  // (onSelectPlayer below) opens details.
  onCloseSwipe: () => void;
  onSelectPlayer: (fpid: number) => void;
}

// Mobile counterpart to PlayerTableRow.tsx - swipe-to-reveal Target/Avoid
// instead of tap-to-expand (there's no room for an inline actions row on a
// phone width), and no Nominate action here at all: MobileNomination.tsx's
// own FAB + search already owns nominating on mobile, so this is purely a
// browse/tag list. $/Market $/pos-rank/pts columns instead of Tier, to fit
// the numbers that matter most for a quick scan in less width.
export function PlayerTableRowMobile({
  row,
  tag,
  standardValue,
  isAuction,
  adp,
  ourRank,
  valueGap,
  consistency,
  injury,
  isRookie,
  isNominated,
  isSwiped,
  onSwipeOpen,
  onSetTag,
  onCloseSwipe,
  onSelectPlayer,
}: PlayerTableRowMobileProps) {
  const ConsistencyIcon = consistency
    ? CONSISTENCY_ICON[consistency]
    : undefined;
  const swipeHandlers = useSwipeReveal(onSwipeOpen, onCloseSwipe);
  // Snake/linear's vs-ADP diff - its own column now (see the Rank column,
  // added ahead of the name below), not combined with the rank number the
  // way AdpValueLabel.tsx does for rows with no separate Rank column.
  const adpDiff =
    !isAuction && ourRank !== undefined && adp !== undefined
      ? Math.round(adp) - ourRank
      : undefined;

  return (
    <Box style={{ position: "relative", overflow: "hidden" }}>
      <Group
        gap={0}
        wrap="nowrap"
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: ACTIONS_WIDTH,
        }}
      >
        <Button
          fullWidth
          radius={0}
          h="100%"
          size="xs"
          fz="xs"
          px={4}
          color="green"
          leftSection={<Crosshair size={12} />}
          onClick={() => onSetTag("target")}
        >
          Target
        </Button>
        <Button
          fullWidth
          radius={0}
          h="100%"
          size="xs"
          fz="xs"
          px={4}
          color="red"
          leftSection={<CircleSlash size={12} />}
          onClick={() => onSetTag("avoid")}
        >
          Avoid
        </Button>
      </Group>

      <Group
        gap={8}
        wrap="nowrap"
        // Stretch (not Group's own default "center") - the name/team Stack
        // has two lines but one of them (icons + an Anchor rendered as a
        // real <button>) is taller than the other, so its own content
        // isn't evenly split top/bottom around the row's true center. That
        // skewed the $/vs Mkt/Pos/Pts cells - centered as plain single-
        // line items - visibly toward the name line instead of the row's
        // middle. Stretching every cell to the row's full height and
        // centering each one's own content inside it (below) anchors them
        // to the actual row center regardless of how the name/team text
        // happens to split that height.
        align="stretch"
        onClick={onCloseSwipe}
        {...swipeHandlers}
        style={{
          position: "relative",
          padding: "10px 6px",
          borderBottom: "1px solid var(--mantine-color-default-border)",
          borderLeft: `3px solid ${
            tag === "target"
              ? "var(--mantine-color-green-6)"
              : tag === "avoid"
                ? "var(--mantine-color-red-6)"
                : "transparent"
          }`,
          // Mantine's "-light" tokens are deliberately translucent (a tint
          // meant to sit over the page), which let the Target/Avoid actions
          // layer underneath bleed through here when not swiped open. An
          // opaque blend against the solid body color instead fully hides
          // it, same as the untagged case already does.
          background: isNominated
            ? "color-mix(in srgb, var(--mantine-color-yellow-6) 20%, var(--mantine-color-body))"
            : tag === "target"
              ? "color-mix(in srgb, var(--mantine-color-green-6) 15%, var(--mantine-color-body))"
              : tag === "avoid"
                ? "color-mix(in srgb, var(--mantine-color-red-6) 15%, var(--mantine-color-body))"
                : "var(--mantine-color-body)",
          transform: `translateX(${isSwiped ? -ACTIONS_WIDTH : 0}px)`,
          transition: "transform 150ms ease",
          touchAction: "pan-y",
        }}
      >
        {!isAuction && (
          <Box
            style={{
              width: 28,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
            }}
          >
            <Text size="sm" fw={700}>
              {ourRank !== undefined ? ourRank : "—"}
            </Text>
          </Box>
        )}
        <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
          <Group gap={4} wrap="nowrap">
            {valueGap?.direction === "undervalued" ? (
              <Tooltip label="Undervalued" withArrow>
                <ThemeIcon size="xs" color="gold" variant="light">
                  <HandCoins size={ICON_SIZE - 4} />
                </ThemeIcon>
              </Tooltip>
            ) : valueGap?.direction === "breakout" ? (
              <Tooltip label="Breakout Player" withArrow>
                <ThemeIcon size="xs" color="grape" variant="light">
                  <Rocket size={ICON_SIZE - 4} />
                </ThemeIcon>
              </Tooltip>
            ) : valueGap?.direction === "falloff" ? (
              <Tooltip label="Falloff Player" withArrow>
                <ThemeIcon size="xs" color="red" variant="light">
                  <TrendingDown size={ICON_SIZE - 4} />
                </ThemeIcon>
              </Tooltip>
            ) : (
              valueGap?.direction === "overvalued" && (
                <Tooltip label="Overvalued" withArrow>
                  <ThemeIcon size="xs" color="red" variant="light">
                    <BanknoteArrowDown size={ICON_SIZE - 4} />
                  </ThemeIcon>
                </Tooltip>
              )
            )}
            {consistency && ConsistencyIcon && (
              <Tooltip label={consistency} withArrow>
                <ThemeIcon
                  size="xs"
                  color={consistencyColor(consistency)}
                  variant="light"
                >
                  <ConsistencyIcon size={ICON_SIZE - 4} />
                </ThemeIcon>
              </Tooltip>
            )}
            <Anchor
              component="button"
              type="button"
              size="sm"
              truncate
              style={{ minWidth: 0 }}
              onClick={(event) => {
                event.stopPropagation();
                onSelectPlayer(row.fpid);
              }}
            >
              {row.name}
            </Anchor>
            {isRookie && <RookieBadge />}
            {injury && (
              <Badge
                color={injuryColor(injury.status)}
                variant="light"
                size="xs"
                circle
              >
                {injury.statusShort}
              </Badge>
            )}
          </Group>
          <Text size="xs" c="dimmed" truncate>
            {row.team ? `${row.team} - Tier ${row.tier}` : `Tier ${row.tier}`}
          </Text>
        </Stack>
        <Box
          style={{
            width: 36,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
          }}
        >
          <Text size="sm" fw={700}>
            {isAuction
              ? `$${Math.round(row.dollarValue)}`
              : adp !== undefined
                ? Math.round(adp)
                : "—"}
          </Text>
        </Box>
        <Box
          style={{
            width: 36,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
          }}
        >
          {isAuction ? (
            <StandardValueLabel
              draftValue={row.dollarValue}
              standardValue={standardValue}
              showLabel={false}
            />
          ) : (
            adpDiff !== undefined && (
              <Text size="sm" fw={600} c={keeperValueColor(adpDiff)}>
                {formatSignedNumber(adpDiff)}
              </Text>
            )
          )}
        </Box>
        <Box
          style={{
            width: 40,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
          }}
        >
          <Text size="xs" fw={700} c={POSITION_COLORS[row.position]}>
            {row.position}
            {row.positionRank}
          </Text>
        </Box>
        <Box
          style={{
            width: 34,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
          }}
        >
          <Text size="xs" c="dimmed">
            {row.points.toFixed(0)}
          </Text>
        </Box>
      </Group>
    </Box>
  );
}
