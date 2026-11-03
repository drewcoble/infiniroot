import { useEffect } from "react";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { Stack, Text } from "@mantine/core";
// convex/react's useConvexAuth, not @convex-dev/auth/react's - same reason
// as infinidraft's __root.tsx: this one waits for server confirmation of
// the token, not just "we have some token value in local state".
import { useConvexAuth, useMutation } from "convex/react";
import { api } from "@infinidata/api";
import { AuthPanel } from "@shared/AuthPanel";
import { PageContainer } from "@shared/PageContainer";
import { RouteErrorFallback } from "@shared/RouteErrorFallback";
import { SignedOutHeader } from "@shared/SignedOutHeader";
import { LoadingSplash, useLoadingSplash } from "../components/LoadingSplash";

export const Route = createRootRoute({
  component: RootComponent,
  errorComponent: RouteErrorFallback,
});

function RootComponent() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  // Upserts the shared userProfiles row on sign-in - same call infinidraft's
  // own __root.tsx makes.
  const ensureUser = useMutation(api.users.ensureCurrentUser);
  useEffect(() => {
    if (isAuthenticated) {
      void ensureUser({});
    }
  }, [ensureUser, isAuthenticated]);
  useLoadingSplash(isLoading);

  return (
    <>
      <RootContent isLoading={isLoading} isAuthenticated={isAuthenticated} />
      <LoadingSplash />
    </>
  );
}

function RootContent({
  isLoading,
  isAuthenticated,
}: {
  isLoading: boolean;
  isAuthenticated: boolean;
}) {
  // The splash covers the whole viewport while auth resolves.
  if (isLoading) {
    return null;
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
            <AuthPanel existingAccountHint="if you already have an infinidraft account, use that same email and password here." />
          </Stack>
        </Stack>
      </PageContainer>
    );
  }

  return <Outlet />;
}
