import { useEffect } from "react";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { Center, Loader, Stack, Text } from "@mantine/core";
// convex/react's useConvexAuth, not @convex-dev/auth/react's - same reason
// as infinidraft's __root.tsx: this one waits for server confirmation of
// the token, not just "we have some token value in local state".
import { useConvexAuth, useMutation } from "convex/react";
import { api } from "@infinidata/api";
import { AuthPanel } from "../components/AuthPanel";
import { PageContainer } from "@shared/PageContainer";
import { SignedOutHeader } from "@shared/SignedOutHeader";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  // Upserts the shared userProfiles row on sign-in - same call infinidraft's
  // own __root.tsx makes. No allowlistedEmails arg: super-admin is an
  // infinidraft-only concept (billing/admin tooling), irrelevant here.
  const ensureUser = useMutation(api.users.ensureCurrentUser);
  useEffect(() => {
    if (isAuthenticated) {
      void ensureUser({});
    }
  }, [ensureUser, isAuthenticated]);

  if (isLoading) {
    return (
      <PageContainer>
        <Stack gap="md">
          <SignedOutHeader wordmark="league" />
          <Center>
            <Loader />
          </Center>
        </Stack>
      </PageContainer>
    );
  }

  if (!isAuthenticated) {
    return (
      <PageContainer>
        <Stack gap="md">
          <SignedOutHeader wordmark="league" />
          <Stack gap="md" maw={420} mx="auto">
            <Text c="dimmed">
              Sign in with your infinidraft account to continue - infinileague
              shares the same login.
            </Text>
            <AuthPanel />
          </Stack>
        </Stack>
      </PageContainer>
    );
  }

  return <Outlet />;
}
