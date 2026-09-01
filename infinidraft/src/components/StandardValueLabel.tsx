import { Text, Tooltip } from "@mantine/core";
import { formatSignedDollar, keeperValueColor } from "../lib/keeperValue";
import type { StandardValueRow } from "../lib/standardValues";

interface StandardValueLabelProps {
  draftValue: number | undefined;
  standardValue: StandardValueRow | undefined;
  // Prefixes the diff with "vs. market" - needed in inline/sentence
  // contexts (no column header saying what the number is), redundant
  // (and prone to wrapping) inside a table cell that already has its own
  // "vs. market" header.
  showLabel?: boolean;
}

// Compact market comparison - this app's own $ value minus a third-party
// draft-kit's $ auction value for the same player (see
// convex/espn/rankings.ts), shown as a +/- diff rather than the raw
// external number so a bargain/overpay is visible at a glance without
// naming the source or adding a whole extra column. Color-coded the same
// green/red-for-surplus-value convention as keeper savings (see
// lib/keeperValue.ts). Renders nothing when there's nothing to diff
// against - deep-bench players the external source doesn't rank, an fpid
// never linked to an external id, or this app's own value isn't available
// yet.
export function StandardValueLabel({
  draftValue,
  standardValue,
  showLabel = true,
}: StandardValueLabelProps) {
  if (!standardValue || draftValue === undefined) return null;
  const diff = Math.round(draftValue) - Math.round(standardValue.auctionValue);
  return (
    <Tooltip
      label={`Market rank #${Math.round(standardValue.rank)} · market value $${Math.round(standardValue.auctionValue)}`}
      withArrow
    >
      <Text size="xs" fw={600} c={keeperValueColor(diff)} span>
        {showLabel ? "vs. market " : ""}
        {formatSignedDollar(diff)}
      </Text>
    </Tooltip>
  );
}
