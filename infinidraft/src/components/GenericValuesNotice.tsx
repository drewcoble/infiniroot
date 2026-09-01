import { Anchor, Text } from "@mantine/core";
import { Link } from "@tanstack/react-router";

// Shown wherever $ values come from convex/draftValues.ts's generic
// 12-team/$200 fallback (isGeneric: true) rather than this league's real
// settings - every free (or signed-out) view of $ values is generic, since
// getDraftValues only computes the real per-league engine for Pro access.
// Use where there's room for a full sentence; for tight spaces (table
// cells, popovers) use GenericValueBadge instead.
export function GenericValuesNotice() {
  return (
    <Text size="xs" c="dimmed">
      Showing default values.{" "}
      <Anchor component={Link} to="/billing" size="xs">
        Upgrade to Pro
      </Anchor>{" "}
      to see custom values for your league's settings and scoring.
    </Text>
  );
}
