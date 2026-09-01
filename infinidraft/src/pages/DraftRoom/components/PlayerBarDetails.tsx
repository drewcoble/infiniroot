import {
  Anchor,
  Badge,
  Button,
  Divider,
  Group,
  Stack,
  Text,
} from "@mantine/core";
import {
  BanknoteArrowDown,
  BatteryLow,
  Crosshair,
  HandCoins,
  Rocket,
  ShieldCheck,
  ThumbsDown,
  TrendingDown,
  TrendingUpDown,
  UserRoundPlus,
} from "lucide-react";
import type { DraftBoardRow, PlayerTag, ValueGap } from "../../../types";
import type { PlanSlotMatch } from "../../../lib/planRecommendation";
import {
  consistencyColor,
  type ConsistencyLabel,
} from "../../../lib/consistency";
import { RookieBadge } from "@shared/RookieBadge";

// Matches the icon choices already used for the bar's own corner badges
// (see PlayerBar.tsx) - kept in sync there rather than imported, since that
// version renders a bare ThemeIcon while this one needs a labeled Badge.
const VALUE_GAP_META: Record<
  ValueGap["direction"],
  { label: string; color: string; icon: typeof HandCoins }
> = {
  undervalued: { label: "Undervalued", color: "yellow", icon: HandCoins },
  breakout: { label: "Breakout", color: "grape", icon: Rocket },
  falloff: { label: "Fall Off", color: "red", icon: TrendingDown },
  overvalued: { label: "Overvalued", color: "red", icon: BanknoteArrowDown },
};

const CONSISTENCY_META: Record<ConsistencyLabel, { icon: typeof ShieldCheck }> =
  {
    Reliable: { icon: ShieldCheck },
    "Boom/Bust": { icon: TrendingUpDown },
    "Low Output": { icon: BatteryLow },
  };

interface PlayerBarDetailsProps {
  row: DraftBoardRow;
  planMatch: PlanSlotMatch | undefined;
  budgetAmount: number | undefined;
  fitsBudget: boolean;
  consistency: ConsistencyLabel | undefined;
  valueGap: ValueGap | undefined;
  isRookie: boolean;
  tag: PlayerTag | undefined;
  onSelectPlayer: () => void;
  onSetTag: (tag: PlayerTag) => void;
  canNominate: boolean;
  onNominate: () => void;
}

// Popover content for a Players Left board bar (see PlayerBar.tsx) - opened
// and kept open by a click (outside click/Escape close it, Mantine Popover
// defaults), unlike the old hover tooltip this replaced, so there's room
// for actual controls (nominate, target/avoid) instead of just a read-only
// preview.
export function PlayerBarDetails({
  row,
  planMatch,
  budgetAmount,
  fitsBudget,
  consistency,
  valueGap,
  isRookie,
  tag,
  onSelectPlayer,
  onSetTag,
  canNominate,
  onNominate,
}: PlayerBarDetailsProps) {
  const valueGapMeta = valueGap
    ? VALUE_GAP_META[valueGap.direction]
    : undefined;
  const ValueGapMetaIcon = valueGapMeta?.icon;
  const consistencyMeta = consistency
    ? CONSISTENCY_META[consistency]
    : undefined;
  const ConsistencyMetaIcon = consistencyMeta?.icon;

  return (
    <Stack gap={6} miw={220}>
      <Group gap={6} wrap="nowrap">
        <Anchor
          component="button"
          type="button"
          size="sm"
          onClick={onSelectPlayer}
        >
          {row.name}
        </Anchor>
        {isRookie && <RookieBadge />}
        {row.team && (
          <Text size="xs" c="dimmed">
            {row.team}
          </Text>
        )}
      </Group>
      <Text size="xs" c="dimmed">
        {row.position}
        {row.positionRank} · {row.tierLabel}
      </Text>
      <Text size="xs">
        ${Math.round(row.dollarValue)} est. · {row.points.toFixed(1)} pts
      </Text>
      {planMatch ? (
        <Text size="xs" c={!fitsBudget ? "orange.6" : "inherit"}>
          {planMatch.slotLabel} budget: ${Math.round(planMatch.amount)}
        </Text>
      ) : (
        budgetAmount !== undefined && (
          <Text size="xs" c={!fitsBudget ? "orange.6" : "inherit"}>
            Budget: ${Math.round(budgetAmount)}
          </Text>
        )
      )}

      {(valueGapMeta || consistencyMeta) && (
        <Group gap={6}>
          {valueGapMeta && ValueGapMetaIcon && (
            <Badge
              color={valueGapMeta.color}
              variant="light"
              leftSection={<ValueGapMetaIcon size={12} />}
            >
              {valueGapMeta.label}
            </Badge>
          )}
          {consistency && consistencyMeta && ConsistencyMetaIcon && (
            <Badge
              color={consistencyColor(consistency)}
              variant="light"
              leftSection={<ConsistencyMetaIcon size={12} />}
            >
              {consistency}
            </Badge>
          )}
        </Group>
      )}

      <Divider />

      {canNominate && (
        <Button
          size="md"
          leftSection={<UserRoundPlus size={14} />}
          onClick={onNominate}
        >
          Nominate
        </Button>
      )}
      <Group gap={6} grow>
        <Button
          size="md"
          variant={tag === "target" ? "filled" : "light"}
          color="green"
          leftSection={<Crosshair size={14} />}
          onClick={() => onSetTag("target")}
        >
          Target
        </Button>
        <Button
          size="md"
          variant={tag === "avoid" ? "filled" : "light"}
          color="red"
          leftSection={<ThumbsDown size={14} />}
          onClick={() => onSetTag("avoid")}
        >
          Avoid
        </Button>
      </Group>
    </Stack>
  );
}
