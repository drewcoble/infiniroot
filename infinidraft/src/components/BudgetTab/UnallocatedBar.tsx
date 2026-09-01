import { Badge, Box, Group } from "@mantine/core";
import { BUDGET_UNALLOCATED_BAR_HEIGHT } from "../../constants/general";
import {
  unallocatedBadgeColor,
  unallocatedBadgeLabel,
} from "../../lib/unallocatedBadge";

interface UnallocatedBarProps {
  unallocated: number;
  isDirty: boolean;
  // Docks directly under whatever's already fixed above it - just
  // AppHeader (MOBILE_HEADER_HEIGHT) on the Setup app's pre-draft Budget
  // tab, or AppHeader + the Draft Room's MobileStatsRow
  // (MOBILE_HEADER_HEIGHT + MOBILE_STATS_ROW_HEIGHT) on the live Budget
  // tab - see BudgetTab.tsx.
  top: number;
}

// The unallocated total and dirty state used to live only in the in-flow
// Group/Stack above and below the slot list, which scrolled out of view as
// soon as you started editing, right when they matter most. Callers must
// reserve BUDGET_UNALLOCATED_BAR_HEIGHT with a spacer, since a `position:
// fixed` element is pulled out of normal document flow.
export function UnallocatedBar({
  unallocated,
  isDirty,
  top,
}: UnallocatedBarProps) {
  return (
    <Box
      hiddenFrom="sm"
      pos="fixed"
      top={top}
      left={0}
      right={0}
      px="md"
      style={{
        // Same tier as MobileStatsRow.tsx's analogous bar - below AppHeader
        // (see its own zIndex comment for why it sits under BottomNav now
        // too), which this docks directly under.
        zIndex: 185,
        minHeight: BUDGET_UNALLOCATED_BAR_HEIGHT,
        display: "flex",
        alignItems: "center",
        background:
          "color-mix(in srgb, var(--mantine-color-body) 75%, transparent)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderBottom: "1px solid var(--mantine-color-default-border)",
      }}
    >
      <Group justify="space-between" wrap="nowrap" style={{ flex: 1 }}>
        <Badge variant="light" color={isDirty ? "yellow" : "teal"} size="lg">
          {isDirty ? "Unsaved changes" : "All changes saved"}
        </Badge>
        <Badge
          variant="light"
          color={unallocatedBadgeColor(unallocated)}
          size="lg"
        >
          {unallocatedBadgeLabel(unallocated)}
        </Badge>
      </Group>
    </Box>
  );
}
