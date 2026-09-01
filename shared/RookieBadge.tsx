import { Badge, Tooltip } from "@mantine/core";

// Deliberately "grape" (the same accent breakout value-gap badges use, see
// ValueGapIcon.tsx) rather than any red/orange/yellow/gray - those are all
// already claimed by injury-status badges (see injuryColor in
// lib/playerFormatting.ts), and "R" sitting next to "IR" in the same style
// would be easy to misread as injury-related.
export function RookieBadge() {
  return (
    <Tooltip label="Rookie" withArrow>
      <Badge color="grape" size="sm" variant="light">
        R
      </Badge>
    </Tooltip>
  );
}
