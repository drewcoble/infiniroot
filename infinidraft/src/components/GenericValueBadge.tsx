import { Anchor, Tooltip } from "@mantine/core";
import { Link } from "@tanstack/react-router";

// Compact counterpart to GenericValuesNotice, for spots too tight for a
// full sentence (table cells, popovers, inline "~$X" tags) - a small,
// itself-clickable "(est.)" marker rather than relying on the tooltip being
// tappable (tooltip content isn't reliably interactive on touch devices).
export function GenericValueBadge() {
  return (
    <Tooltip
      label="Estimated from a generic 12-team/$200 league, not yours - tap to upgrade"
      withArrow
      multiline
      w={220}
    >
      <Anchor component={Link} to="/billing" size="xs" c="dimmed">
        (est.)
      </Anchor>
    </Tooltip>
  );
}
