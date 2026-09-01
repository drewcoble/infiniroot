import { ThemeIcon, Tooltip } from "@mantine/core";
import {
  BanknoteArrowDown,
  HandCoins,
  Rocket,
  TrendingDown,
} from "lucide-react";
import type { Position, ValueGap } from "../../../types";

interface ValueGapIconProps {
  valueGap: ValueGap;
  position: Position;
}

export function ValueGapIcon({ valueGap, position }: ValueGapIconProps) {
  return (
    <Tooltip
      label={`Last year: ${valueGap.lastYearPpg.toFixed(1)} ppg (${position}${valueGap.lastYearRank}) · This year proj ${position}${valueGap.projRank} · ADP ${position}${valueGap.adpRank}`}
      multiline
      w={260}
      withArrow
    >
      {valueGap.direction === "undervalued" ? (
        <ThemeIcon radius="md" color="yellow" size="md" variant="light">
          <HandCoins size={16} strokeWidth={2} />
        </ThemeIcon>
      ) : valueGap.direction === "breakout" ? (
        <ThemeIcon radius="md" color="grape" size="md" variant="light">
          <Rocket size={16} strokeWidth={2} />
        </ThemeIcon>
      ) : valueGap.direction === "falloff" ? (
        <ThemeIcon color="red" size="md" radius="md" variant="light">
          <TrendingDown size={16} strokeWidth={2} />
        </ThemeIcon>
      ) : (
        <ThemeIcon color="red" size="md" radius="md" variant="light">
          <BanknoteArrowDown size={16} strokeWidth={2} />
        </ThemeIcon>
      )}
    </Tooltip>
  );
}
