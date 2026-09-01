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
import type { Doc } from "@infinidata/dataModel";
import { ICON_SIZE } from "../../../constants/playersLeft";
import {
  consistencyColor,
  type ConsistencyLabel,
} from "../../../lib/consistency";
import { injuryColor } from "@shared/injuryColor";
import { POSITION_COLORS } from "@shared/positionColors";
import type { StandardValueRow } from "../../../lib/standardValues";
import type { PlayerTag, ValueGap } from "../../../types";
import { RookieBadge } from "@shared/RookieBadge";
import { StandardValueLabel } from "../../../components/StandardValueLabel";
import { AdpValueLabel } from "../../../components/AdpValueLabel";
import { useSwipeReveal } from "../../../hooks/useSwipeReveal";

// Same icon choices ValueGapIcon.tsx/ConsistencyIcon.tsx use (those render a
// larger fixed "md" ThemeIcon, too big for this compact row) - kept in sync
// there rather than imported, same duplication convention
// PlayerTableRowMobile.tsx (the Draft Room's version of this row) already
// uses for the same reason.
const CONSISTENCY_ICON: Record<ConsistencyLabel, typeof ShieldCheck> = {
  Reliable: ShieldCheck,
  "Boom/Bust": TrendingUpDown,
  "Low Output": BatteryLow,
};

// Width of the Target/Avoid action strip a row reveals when swiped left -
// the row's own content slides left by exactly this much to expose it.
const ACTIONS_WIDTH = 192;

interface PlayerRowMobileProps {
  row: Doc<"projections">;
  points: number;
  injury: { status: string; statusShort: string } | undefined;
  isRookie: boolean;
  draftValue:
    | {
        dollarValue: number;
        usedFallback: boolean;
        positionRank: number;
        tier: number;
        tierLabel: string;
      }
    | undefined;
  standardValue: StandardValueRow | undefined;
  // Auction: $ / vs. market (draftValue/standardValue above). Snake/linear:
  // ADP / vs ADP (adp/ourRank below) - see PlayersTable.tsx's
  // blendedAdpByFpid/ourRankByFpid for how these are built.
  isAuction: boolean;
  adp: number | undefined;
  ourRank: number | undefined;
  valueGap: ValueGap | undefined;
  showValueColumn: boolean;
  tag: PlayerTag | undefined;
  // undefined (rather than a no-op) when no league's selected - swipe still
  // opens, but the buttons themselves are disabled, same as PlayerRow.tsx's
  // desktop ActionIcon ("Select a league to mark targets/avoids"). Direct
  // set (not cycle) since Target/Avoid are separate buttons here, same as
  // PlayerTableRowMobile.tsx's onSetTag.
  onSetTag: ((tag: PlayerTag) => void) | undefined;
  onSelectPlayer: (fpid: number) => void;
  consistency: ConsistencyLabel | undefined;
  showConsistencyColumn: boolean;
  // Only one row is ever swiped open at a time - PlayersTable.tsx owns that
  // single id rather than each row tracking its own.
  isSwiped: boolean;
  onSwipeOpen: () => void;
  onCloseSwipe: () => void;
}

// Mobile counterpart to PlayerRow.tsx - swipe-to-reveal Target/Avoid instead
// of a per-row icon button, and no Keeper column (that's read-only info
// tucked behind desktop's expand chevron already; edit it from the Keepers
// tab, not here). $/vs Mkt/Pos(+rank)/Pts columns, same shape as the Draft
// Room's own PlayerTableRowMobile.tsx, so the two mobile tables read the
// same way - but keyed off Doc<"projections"> instead of DraftBoardRow,
// since this table has no tier/nomination concept pre-draft.
export function PlayerRowMobile({
  row,
  points,
  injury,
  isRookie,
  draftValue,
  standardValue,
  isAuction,
  adp,
  ourRank,
  valueGap,
  showValueColumn,
  tag,
  onSetTag,
  onSelectPlayer,
  consistency,
  showConsistencyColumn,
  isSwiped,
  onSwipeOpen,
  onCloseSwipe,
}: PlayerRowMobileProps) {
  const ConsistencyIcon =
    showConsistencyColumn && consistency
      ? CONSISTENCY_ICON[consistency]
      : undefined;
  const swipeHandlers = useSwipeReveal(onSwipeOpen, onCloseSwipe);

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
          disabled={!onSetTag}
          leftSection={<Crosshair size={12} />}
          onClick={() => onSetTag?.("target")}
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
          disabled={!onSetTag}
          leftSection={<CircleSlash size={12} />}
          onClick={() => onSetTag?.("avoid")}
        >
          Avoid
        </Button>
      </Group>

      <Group
        gap={8}
        wrap="nowrap"
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
          // Opaque blend against the solid body color (not Mantine's
          // translucent "-light" tokens) so a tagged row still fully hides
          // the Target/Avoid actions layer underneath when not swiped open
          // - see PlayerTableRowMobile.tsx's own copy of this same fix.
          background:
            tag === "target"
              ? "color-mix(in srgb, var(--mantine-color-green-6) 15%, var(--mantine-color-body))"
              : tag === "avoid"
                ? "color-mix(in srgb, var(--mantine-color-red-6) 15%, var(--mantine-color-body))"
                : "var(--mantine-color-body)",
          transform: `translateX(${isSwiped ? -ACTIONS_WIDTH : 0}px)`,
          transition: "transform 150ms ease",
          touchAction: "pan-y",
        }}
      >
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
            {draftValue
              ? row.team
                ? `${row.team} - Tier ${draftValue.tier}`
                : `Tier ${draftValue.tier}`
              : (row.team ?? "—")}
          </Text>
        </Stack>
        {showValueColumn && (
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
                ? draftValue
                  ? `$${Math.round(draftValue.dollarValue)}`
                  : "—"
                : adp !== undefined
                  ? Math.round(adp)
                  : "—"}
            </Text>
          </Box>
        )}
        {showValueColumn && (
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
                draftValue={draftValue?.dollarValue}
                standardValue={standardValue}
                showLabel={false}
              />
            ) : (
              <AdpValueLabel ourRank={ourRank} adp={adp} showLabel={false} />
            )}
          </Box>
        )}
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
            {draftValue?.positionRank ?? ""}
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
            {points.toFixed(0)}
          </Text>
        </Box>
      </Group>
    </Box>
  );
}
