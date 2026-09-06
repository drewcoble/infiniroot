import { Group, Text } from "@mantine/core";
import { RookieBadge } from "@infiniroot/shared";

export function Default() {
  return <RookieBadge />;
}

export function InContext() {
  return (
    <Group gap={6}>
      <Text size="sm" fw={500}>
        Marvin Harrison Jr.
      </Text>
      <RookieBadge />
    </Group>
  );
}
