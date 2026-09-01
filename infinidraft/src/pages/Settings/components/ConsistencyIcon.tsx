import { ThemeIcon, Tooltip } from "@mantine/core";
import { BatteryLow, ShieldCheck, TrendingUpDown } from "lucide-react";
import { consistencyColor, type ConsistencyLabel } from "../../../lib/consistency";

interface ConsistencyIconProps {
  label: ConsistencyLabel;
}

export function ConsistencyIcon({ label }: ConsistencyIconProps) {
  const tooltip =
    label === "Reliable"
      ? "Reliable - consistently high scoring"
      : label === "Boom/Bust"
        ? "Boom/Bust - high scoring, high variance"
        : "Low Output - consistently low scoring";

  return (
    <Tooltip label={tooltip} multiline w={260} withArrow>
      <ThemeIcon
        radius="md"
        size="md"
        variant="light"
        color={consistencyColor(label)}
      >
        {label === "Reliable" ? (
          <ShieldCheck size={16} strokeWidth={2} />
        ) : label === "Boom/Bust" ? (
          <TrendingUpDown size={16} strokeWidth={2} />
        ) : (
          <BatteryLow size={16} strokeWidth={2} />
        )}
      </ThemeIcon>
    </Tooltip>
  );
}
