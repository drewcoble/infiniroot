import { Badge, Card, Group, Stack, Text } from "@mantine/core";
import { positionColorOrDefault } from "@shared/positionColors";
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
              <Group key={start.fpid} gap={6} wrap="wrap" align="center">
                <Text size="sm" span>
                  Start
                </Text>
                <Badge size="sm" variant="light" color={positionColorOrDefault(start.position)}>
                  {start.position}
                </Badge>
                <Text size="sm" fw={600} span>
                  {start.name}
                </Text>
                <Text size="sm" c="dimmed" span>
                  at
                </Text>
                <Badge size="sm" variant="light" color={positionColorOrDefault(start.slot)}>
                  {start.slot}
                </Badge>
                {sit ? (
                  <>
                    <Text size="sm" c="dimmed" span>
                      · Sit
                    </Text>
                    <Badge size="sm" variant="light" color={positionColorOrDefault(sit.position)}>
                      {sit.position}
                    </Badge>
                    <Text size="sm" fw={600} span>
                      {sit.name}
                    </Text>
                  </>
                ) : (
                  <Text size="sm" c="dimmed" span>
                    · currently an empty slot
                  </Text>
                )}
                <Text
                  size="xs"
                  c={delta > 0 ? "green" : "dimmed"}
                  span
                  ml="auto"
                >
                  {formatDelta(delta)} pts
                </Text>
              </Group>
            );
          })}
        </Stack>
      </Stack>
    </Card>
  );
}
