import { Card, Group, Stack, Text } from "@mantine/core";
import { ArrowDown, ArrowUp } from "lucide-react";
import { buildLineupSuggestions } from "../lib/lineupSuggestions";
import type { TeamRosterRow } from "../types/season";

interface LineupSuggestionsCardProps {
  rows: TeamRosterRow[];
}

function formatDelta(points: number): string {
  return `${points >= 0 ? "+" : ""}${points.toFixed(1)}`;
}

// Renders nothing at all (not even an empty-state card) when there's
// nothing to suggest - either the team isn't Sleeper-linked (no slot data
// to diff against, see lib/lineupSuggestions.ts) or the actual lineup is
// already points-optimal, both of which are the common case most weeks.
export function LineupSuggestionsCard({ rows }: LineupSuggestionsCardProps) {
  const suggestions = buildLineupSuggestions(rows);
  if (suggestions.length === 0) return null;

  return (
    <Card withBorder padding="md">
      <Stack gap="sm">
        <Text size="sm" fw={500}>
          Suggested lineup adjustments
        </Text>
        <Stack gap={10}>
          {suggestions.map(({ start, sit }) => {
            const delta = start.projectedPoints - (sit?.projectedPoints ?? 0);
            return (
              <Stack key={start.fpid} gap={2}>
                <Group gap={6} wrap="nowrap" align="center">
                  <ArrowUp size={14} color="var(--mantine-color-green-6)" />
                  <Text size="sm" fw={600} span>
                    {start.name}
                  </Text>
                  <Text size="sm" c="dimmed" span>
                    {start.projectedPoints.toFixed(1)}
                  </Text>
                  <Text size="xs" c={delta > 0 ? "green" : "dimmed"} span ml="auto">
                    {formatDelta(delta)} pts
                  </Text>
                </Group>
                {sit ? (
                  <Group gap={6} wrap="nowrap" align="center" ml={5}>
                    <ArrowDown size={14} color="var(--mantine-color-red-6)" />
                    <Text size="sm" fw={600} span>
                      {sit.name}
                    </Text>
                    <Text size="sm" c="dimmed" span>
                      {sit.projectedPoints.toFixed(1)}
                    </Text>
                  </Group>
                ) : (
                  <Text size="sm" c="dimmed" span ml={25}>
                    Currently an empty slot
                  </Text>
                )}
              </Stack>
            );
          })}
        </Stack>
      </Stack>
    </Card>
  );
}
