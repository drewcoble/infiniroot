import { Badge, Card, Group, Stack, Text } from "@mantine/core";
import { positionColorOrDefault } from "@shared/positionColors";
import { RookieBadge } from "@shared/RookieBadge";
import type { RosVorRow } from "../types/season";

interface PlayerCardProps {
  row: RosVorRow;
  isRookie: boolean;
}

// One row of infinileague's Players tab (src/routes/league/$leagueId/
// players.tsx) - deliberately spare rather than a dense stat table, since
// the tab's whole point is scanning hundreds of players at a glance. Rank
// stays vertically centered against the whole card (Group's default
// align="center") while the name/position/team/PPG detail stacks into two
// rows. Fixed height so the virtualizer driving that list can size it
// exactly (see PLAYER_CARD_HEIGHT there) - if this card's rendered height
// ever changes, that constant needs to move with it.
export function PlayerCard({ row, isRookie }: PlayerCardProps) {
  return (
    <Card withBorder padding="xs" radius="md">
      <Group wrap="nowrap" gap="sm">
        <Text size="sm" fw={700} c="dimmed" w={28} ta="right">
          {row.rosRank}
        </Text>
        <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
          <Group gap={6} wrap="nowrap">
            <Text size="sm" fw={500} truncate>
              {row.name}
            </Text>
            {isRookie && <RookieBadge />}
          </Group>
          <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
            <Badge size="sm" color={positionColorOrDefault(row.position)} variant="light">
              {row.position}
            </Badge>
            {row.team && (
              <Text c="dimmed" size="xs">
                {row.team}
              </Text>
            )}
            {row.rosteredByTeamName ? (
              <Text c="dimmed" size="xs" truncate>
                {row.rosteredByTeamName}
              </Text>
            ) : (
              <Badge size="sm" variant="outline" color="gray">
                FA
              </Badge>
            )}
          </Group>
        </Stack>
        <Stack gap={2} align="flex-end">
          <Text size="xs" c="dimmed">
            {row.actualPpg.toFixed(1)} PPG
          </Text>
          <Text size="xs" c="dimmed">
            {row.rosPpg.toFixed(1)} ROS PPG
          </Text>
        </Stack>
      </Group>
    </Card>
  );
}
