import { Badge, Card, Group, Text } from "@mantine/core";
import { positionColorOrDefault } from "@shared/positionColors";
import { RookieBadge } from "@shared/RookieBadge";
import type { RosVorRow } from "../types/season";

interface PlayerCardProps {
  row: RosVorRow;
  isRookie: boolean;
}

// One row of infinileague's Players tab (src/routes/league/$leagueId/
// players.tsx) - deliberately spare (rank, name, position, NFL team,
// rostered-by) rather than a dense stat table, since the tab's whole point
// is scanning hundreds of players at a glance. Fixed-height single row so
// the virtualizer driving that list can size it exactly (see
// PLAYER_CARD_HEIGHT there).
export function PlayerCard({ row, isRookie }: PlayerCardProps) {
  return (
    <Card withBorder padding="xs" radius="md">
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
          <Text size="sm" fw={700} c="dimmed" w={32} ta="right">
            {row.rosRank}
          </Text>
          <Badge size="sm" color={positionColorOrDefault(row.position)} variant="light" w={44}>
            {row.position}
          </Badge>
          <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
            <Text size="sm" fw={500} truncate>
              {row.name}
            </Text>
            {isRookie && <RookieBadge />}
            {row.team && (
              <Text c="dimmed" size="sm">
                {row.team}
              </Text>
            )}
          </Group>
        </Group>
        {row.rosteredByTeamName ? (
          <Text size="sm" c="dimmed" truncate maw={140}>
            {row.rosteredByTeamName}
          </Text>
        ) : (
          <Badge size="sm" variant="outline" color="gray">
            FA
          </Badge>
        )}
      </Group>
    </Card>
  );
}
