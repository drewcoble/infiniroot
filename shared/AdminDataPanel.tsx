import { useQuery } from "convex/react";
import { ActionIcon, Button, Center, Group, Loader, Stack, Text, Title } from "@mantine/core";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { api } from "@infinidata/api";
import { DataPanel } from "./DataPanel";

// Super-admin-only data-fetch tool, shared across every app since the sync
// it triggers (DataPanel) is entirely league-independent. Renders just its
// own content, not PageContainer/AppHeader - the route in each app supplies
// those (see e.g. infinidraft/src/routes/admin-data.tsx), same pattern as
// ConnectSleeperLeague.tsx.
export function AdminDataPanel() {
  const currentUser = useQuery(api.users.getCurrentUser);

  if (currentUser === undefined) {
    return (
      <Center>
        <Loader />
      </Center>
    );
  }

  if (currentUser?.role !== "super-admin") {
    return (
      <Stack gap="md" align="center">
        <Text c="dimmed">You don't have access to this page.</Text>
        <Button component={Link} to="/" variant="default">
          Back to dashboard
        </Button>
      </Stack>
    );
  }

  return (
    <Stack gap="lg" maw={900} mx="auto">
      <Group gap="xs">
        <ActionIcon
          component={Link}
          to="/"
          variant="subtle"
          color="gray"
          aria-label="Back to dashboard"
        >
          <ArrowLeft size={18} />
        </ActionIcon>
        <Title order={2}>Admin: Data</Title>
      </Group>

      <DataPanel />
    </Stack>
  );
}
