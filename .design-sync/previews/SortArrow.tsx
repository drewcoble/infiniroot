import { Group, Text } from "@mantine/core";
import { SortArrow } from "@infiniroot/shared";

export function Ascending() {
  return (
    <Group gap={4}>
      <Text size="sm" fw={700}>
        Points
      </Text>
      <SortArrow dir="asc" size={16} />
    </Group>
  );
}

export function Descending() {
  return (
    <Group gap={4}>
      <Text size="sm" fw={700}>
        Points
      </Text>
      <SortArrow dir="desc" size={16} />
    </Group>
  );
}

export function InTableHeader() {
  return (
    <Group gap="lg">
      <Group gap={4}>
        <Text size="sm" c="dimmed">
          Rank
        </Text>
      </Group>
      <Group gap={4}>
        <Text size="sm" fw={700}>
          ROS PPG
        </Text>
        <SortArrow dir="desc" size={12} />
      </Group>
      <Group gap={4}>
        <Text size="sm" c="dimmed">
          Team
        </Text>
      </Group>
    </Group>
  );
}
