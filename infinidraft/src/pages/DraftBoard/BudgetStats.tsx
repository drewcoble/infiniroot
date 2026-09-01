import { Group, Stack, Text } from "@mantine/core";
import { TeamBudgetStats } from "../../lib/teamBudget";

const BudgetStats = ({ stats }: { stats: TeamBudgetStats }) => {
  return (
    <Stack gap={4} align="flex-end" style={{ flexShrink: 0 }}>
      <Group gap={6} wrap="nowrap">
        <Text size="xs" c="dimmed">
          max bid
        </Text>
        <Text fw={700} size="sm">
          ${Math.max(stats.maxBid, 0)}
        </Text>
      </Group>
      <Group gap={6} wrap="nowrap">
        <Text size="xs" c="dimmed">
          empty spots
        </Text>
        <Text fw={500} size="sm">
          {stats.openSlots}
        </Text>
      </Group>
    </Stack>
  );
};

export default BudgetStats;
