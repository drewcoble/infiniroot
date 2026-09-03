import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { api } from "@infinidata/api";
import { AppHeader } from "../../components/AppHeader";
import { PageContainer } from "@shared/PageContainer";
import { getErrorMessage } from "@shared/errors";

// Super-admin-only tool for granting a user Pro access without collecting
// payment (e.g. friends/family, press, support goodwill) - see
// convex/billing/mutations.ts's setCompAccess and entitlements.ts's
// hasProAccess for how a comp coexists with a real Stripe subscription.
export function AdminBillingPanel() {
  const currentUser = useQuery(api.users.getCurrentUser);
  const [email, setEmail] = useState("");
  const [searchedEmail, setSearchedEmail] = useState<string | null>(null);
  const found = useQuery(
    api.infinidraft.billing.queries.findUserForComp,
    searchedEmail ? { email: searchedEmail } : "skip",
  );
  const setCompAccess = useMutation(api.infinidraft.billing.mutations.setCompAccess);
  const [note, setNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const handleToggleComp = async (comped: boolean) => {
    if (!found) return;
    setIsSaving(true);
    setError(null);
    try {
      await setCompAccess({
        targetUserId: found.userId,
        comped,
        ...(note ? { note } : {}),
      });
    } catch (err) {
      setError(getErrorMessage(err, "Failed to update comp access."));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <PageContainer>
      <Stack gap="lg">
        <AppHeader />
        <Stack gap="lg" maw={480} mx="auto">
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
            <Title order={2}>Admin: Comp Access</Title>
          </Group>

          <Card withBorder padding="lg">
            <Stack gap="sm">
              <Group align="flex-end">
                <TextInput
                  label="User email"
                  placeholder="user@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.currentTarget.value)}
                  style={{ flex: 1 }}
                />
                <Button
                  onClick={() => setSearchedEmail(email.trim())}
                  disabled={!email.trim()}
                >
                  Search
                </Button>
              </Group>

              {searchedEmail && found === undefined && (
                <Center py="md">
                  <Loader size="sm" />
                </Center>
              )}
              {searchedEmail && found === null && (
                <Text size="sm" c="dimmed">
                  No user found with that email.
                </Text>
              )}
              {found && (
                <Stack gap="xs" pt="sm">
                  <Group justify="space-between">
                    <Text fw={600}>{found.name}</Text>
                    <Badge color={found.comped ? "green" : "gray"}>
                      {found.comped ? "Comped" : "Not comped"}
                    </Badge>
                  </Group>
                  <Text size="sm" c="dimmed">
                    Subscription status: {found.status}
                  </Text>
                  <TextInput
                    label="Note (optional)"
                    placeholder="Reason for comp access"
                    value={note}
                    onChange={(e) => setNote(e.currentTarget.value)}
                  />
                  <Group>
                    <Button
                      onClick={() => void handleToggleComp(true)}
                      loading={isSaving}
                      disabled={found.comped}
                    >
                      Grant comp access
                    </Button>
                    <Button
                      onClick={() => void handleToggleComp(false)}
                      loading={isSaving}
                      variant="light"
                      color="red"
                      disabled={!found.comped}
                    >
                      Revoke comp access
                    </Button>
                  </Group>
                  {error && (
                    <Text size="sm" c="red">
                      {error}
                    </Text>
                  )}
                </Stack>
              )}
            </Stack>
          </Card>
        </Stack>
      </Stack>
    </PageContainer>
  );
}
