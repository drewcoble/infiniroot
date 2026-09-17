import { Card, Text } from "@mantine/core";
import { PageContainer } from "@infiniroot/shared";

export function Default() {
  return (
    <PageContainer>
      <Card withBorder padding="lg">
        <Text fw={600}>Page content</Text>
        <Text size="sm" c="dimmed">
          PageContainer centers this at a max width and reserves top padding
          for the fixed mobile header.
        </Text>
      </Card>
    </PageContainer>
  );
}
