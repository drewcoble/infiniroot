import { Card, Text } from "@mantine/core";

interface StatTileProps {
  label: string;
  value: string;
  valueColor?: string;
}

export function StatTile({ label, value, valueColor = "inherit" }: StatTileProps) {
  return (
    <Card withBorder padding="sm" h="100%">
      <Text size="xs" c="dimmed" tt="uppercase">
        {label}
      </Text>
      <Text size="xl" fw={700} c={valueColor}>
        {value}
      </Text>
    </Card>
  );
}
