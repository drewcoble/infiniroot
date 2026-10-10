import { ActionIcon, Button, Group, Text } from "@mantine/core";
import { ChevronLeft, ChevronRight } from "lucide-react";

// Prev/next week stepper for a page's title row (Matchup, My Team), plus a
// "This week" jump back whenever another week is showing.
export function WeekPicker({
  week,
  currentWeek,
  lastWeek,
  onChange,
}: {
  week: number;
  currentWeek: number | null;
  lastWeek: number;
  onChange: (week: number) => void;
}) {
  return (
    <Group gap={4} wrap="nowrap">
      {currentWeek !== null && week !== currentWeek && (
        <Button variant="subtle" size="compact-sm" onClick={() => onChange(currentWeek)}>
          This week
        </Button>
      )}
      <ActionIcon
        variant="subtle"
        aria-label="Previous week"
        disabled={week <= 1}
        onClick={() => onChange(week - 1)}
      >
        <ChevronLeft size={18} />
      </ActionIcon>
      <Text fw={600} style={{ minWidth: 64, textAlign: "center" }}>
        Week {week}
      </Text>
      <ActionIcon
        variant="subtle"
        aria-label="Next week"
        disabled={week >= lastWeek}
        onClick={() => onChange(week + 1)}
      >
        <ChevronRight size={18} />
      </ActionIcon>
    </Group>
  );
}
