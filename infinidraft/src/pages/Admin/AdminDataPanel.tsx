import { useQuery } from "convex/react";
import {
  ActionIcon,
  Button,
  Center,
  Group,
  Loader,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { api } from "@infinidata/api";
import { AppHeader } from "../../components/AppHeader";
import { PageContainer } from "@shared/PageContainer";
import { WEEK } from "../../constants/general";
import { DataPanel } from "../Settings/DataPanel";

// Super-admin-only data-fetch tool, formerly a per-league Setup tab -
// DataPanel itself is entirely league-independent (its actions loop over
// every league in the database), so it lives here as its own page rather
// than nested under a specific league's route.
export function AdminDataPanel() {
  const currentUser = useQuery(api.users.getCurrentUser);

  if (currentUser === undefined) {
    return (
      <PageContainer>
        <Stack gap="lg">
          <AppHeader />
          <Center>
            <Loader />
          </Center>
        </Stack>
      </PageContainer>
    );
  }

  if (currentUser?.role !== "super-admin") {
    return (
      <PageContainer>
        <Stack gap="lg">
          <AppHeader />
          <Stack gap="md" align="center">
            <Text c="dimmed">You don't have access to this page.</Text>
            <Button component={Link} to="/" variant="default">
              Back to dashboard
            </Button>
          </Stack>
        </Stack>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <Stack gap="lg">
        <AppHeader />
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

          <DataPanel week={WEEK} />
        </Stack>
      </Stack>
    </PageContainer>
  );
}
