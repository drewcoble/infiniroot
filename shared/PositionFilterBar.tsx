import { Badge, Box, Button, Group, UnstyledButton } from "@mantine/core";
import { positionColorVar, type Position } from "./positionColors";
import { POSITION_FILTER_BAR_HEIGHT } from "./constants";

interface PositionFilterBarProps {
  positions: readonly Position[];
  selected: Position[];
  onChange: (positions: Position[]) => void;
  // Mobile-only fixed offset (px) from the top of the viewport - below
  // whatever's already docked there (MOBILE_HEADER_HEIGHT, plus each app's
  // own additional docked bars, e.g. infinidraft's MOBILE_STATS_ROW_HEIGHT
  // in the Draft Room). See each call site for its value, and
  // POSITION_FILTER_BAR_HEIGHT's comment for why callers need to reserve
  // space for this bar themselves.
  top: number;
}

// Position filter used above player list/table views in both apps - one
// 40px circle per position (colored via POSITION_COLORS, filled when
// selected) instead of small Chip pills. Each circle carries a tiny "only"
// badge sitting in normal flow right after it, vertically centered against
// the circle and pulled left (negative margin) so its left edge tucks
// behind the circle's lower z-index silhouette - a lower-emphasis
// affordance for "just this one" that doesn't compete with the circle
// itself as the primary tap target. Flow layout (not absolute positioning)
// on purpose: an absolutely-positioned badge could get clipped by an
// ancestor's overflow, which is exactly what cut its text off before.
//
// Below "sm", this docks fixed under the header (native-app-style, same
// pattern as infinidraft's own MobileStatsRow) and scrolls horizontally
// instead of wrapping - wrapping to a second row was eating too much
// vertical space on a phone. At "sm" and up there's normally enough width
// that it never wrapped anyway, so that breakpoint keeps the plain static,
// wrapping layout.
export function PositionFilterBar({
  positions,
  selected,
  onChange,
  top,
}: PositionFilterBarProps) {
  const allButton = (
    <Button variant="default" h={40} onClick={() => onChange([...positions])}>
      All
    </Button>
  );

  const circles = positions.map((pos) => {
    const isSelected = selected.includes(pos);
    return (
      <Box
        key={pos}
        h={40}
        style={{ flexShrink: 0, display: "flex", alignItems: "center" }}
      >
        <UnstyledButton
          type="button"
          aria-pressed={isSelected}
          aria-label={`Toggle ${pos} filter`}
          onClick={() =>
            onChange(
              isSelected
                ? selected.filter((p) => p !== pos)
                : [...selected, pos],
            )
          }
          style={{
            position: "relative",
            zIndex: 2,
            width: 40,
            height: 40,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            fontWeight: 700,
            transition:
              "background-color 120ms ease, color 120ms ease, border-color 120ms ease",
            backgroundColor: isSelected
              ? positionColorVar(pos, 7)
              : "var(--mantine-color-default)",
            color: isSelected
              ? "var(--mantine-color-white)"
              : positionColorVar(pos, 6),
            border: isSelected
              ? "2px solid transparent"
              : `1.5px solid ${positionColorVar(pos, 6)}`,
          }}
        >
          {pos}
        </UnstyledButton>
        <Badge
          component="button"
          type="button"
          aria-label={`Show only ${pos}`}
          onClick={(event) => {
            event.stopPropagation();
            onChange([pos]);
          }}
          size="md"
          variant="filled"
          color="gray"
          style={{
            position: "relative",
            zIndex: 1,
            marginLeft: -10,
            cursor: "pointer",
            height: 22,
            paddingLeft: 14,
            paddingRight: 9,
            fontSize: 10,
            lineHeight: "22px",
            whiteSpace: "nowrap",
          }}
        >
          only
        </Badge>
      </Box>
    );
  });

  return (
    <>
      <Box
        hiddenFrom="sm"
        pos="fixed"
        top={top}
        left={0}
        right={0}
        px="md"
        py={8}
        style={{
          // Below AppHeader/whatever else is docked (see each app's own
          // AppHeader.tsx for its zIndex comment) - this docks directly
          // under whichever of those is above it.
          zIndex: 180,
          minHeight: POSITION_FILTER_BAR_HEIGHT,
          overflowX: "auto",
          background:
            "color-mix(in srgb, var(--mantine-color-body) 75%, transparent)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          borderBottom: "1px solid var(--mantine-color-default-border)",
        }}
      >
        <Group gap="md" wrap="nowrap" style={{ width: "max-content" }}>
          {allButton}
          {circles}
        </Group>
      </Box>
      <Group gap="md" wrap="wrap" visibleFrom="sm">
        {allButton}
        {circles}
      </Group>
    </>
  );
}
