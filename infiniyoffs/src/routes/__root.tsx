import { useEffect } from "react";
import { createRootRoute, Outlet, useLocation } from "@tanstack/react-router";
import { Center, Loader, Stack, Text } from "@mantine/core";
// convex/react's useConvexAuth, not @convex-dev/auth/react's - same reason
// as the other apps' __root.tsx: this one waits for server confirmation
// of the token, not just "we have some token value in local state".
import { useConvexAuth, useMutation } from "convex/react";
import { api } from "@infinidata/api";
import { AuthPanel } from "@shared/AuthPanel";
import { PageContainer } from "@shared/PageContainer";
import { RouteErrorFallback } from "@shared/RouteErrorFallback";
import { SignedOutHeader } from "@shared/SignedOutHeader";

export const Route = createRootRoute({
  component: RootComponent,
  errorComponent: RouteErrorFallback,
});

function RootComponent() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  // Invite links mostly bring new people - show them sign-up first.
  const invited = /^\/(invite|join)\//.test(useLocation().pathname);
  // Upserts the shared userProfiles row on sign-in - same call the other
  // apps' __root.tsx make.
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
          <SignedOutHeader wordmark="yoffs" />
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
          <SignedOutHeader wordmark="yoffs" />
          <Stack gap="md" maw={420} mx="auto">
            <Text c="dimmed">
              Sign in with your infinidraft/infinileague/infinifaab account to
              continue - infiniyoffs shares the same login.
            </Text>
            <AuthPanel
              initialMode={invited ? "signUp" : "signIn"}
              existingAccountHint="if you already have an infinidraft/infinileague/infinifaab account, use that same email and password here."
            />
          </Stack>
        </Stack>
      </PageContainer>
    );
  }

  return <Outlet />;
}
