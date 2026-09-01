import { useEffect, useMemo } from "react";
import { createRootRoute, Outlet, useLocation } from "@tanstack/react-router";
import { Center, Loader, Stack, Text } from "@mantine/core";
// convex/react's useConvexAuth, NOT @convex-dev/auth/react's - the latter's
// isAuthenticated only means "we have some token value in local state"
// (tokenState !== null), true the instant a token is read from storage or a
// sign-in call returns, with no guarantee the server has actually accepted
// it yet. This one is explicitly documented as "the server has confirmed
// the current token" (see node_modules/convex/dist/esm-types/react/
// ConvexAuthState.d.ts) - the reliable signal for "is it safe to run an
// authenticated query," which is exactly what gates <Outlet/> below.
import { useConvexAuth, useMutation } from "convex/react";
import { api } from "@infinidata/api";
import { AuthPanel } from "../components/AuthPanel";
import { PageContainer } from "@shared/PageContainer";
import { RouteErrorFallback } from "../components/RouteErrorFallback";
import { SignedOutHeader } from "@shared/SignedOutHeader";
import { getConfiguredSuperAdminEmails } from "../lib/superAdmin";

export const Route = createRootRoute({
  component: RootComponent,
  errorComponent: RouteErrorFallback,
});

function RootComponent() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const ensureUser = useMutation(api.users.ensureCurrentUser);
  const configuredSuperAdminEmails = useMemo(
    () => getConfiguredSuperAdminEmails(),
    [],
  );
  // The TV board (/board/$leagueId) and the Report Card (/reportCard/
  // $leagueId) are readonly pages meant to be shared with anyone via link
  // (e.g. cast on a TV during a live auction, or dropped in the league
  // group chat after a draft) - they must never sit behind this sign-in
  // wall, so they're exempted here rather than nested under a protected
  // layout route (see each route file's own comment for why it isn't
  // nested under one already).
  const { pathname } = useLocation();
  const isPublicRoute =
    pathname.startsWith("/board/") || pathname.startsWith("/reportCard/");

  useEffect(() => {
    if (isAuthenticated) {
      void ensureUser({ allowlistedEmails: configuredSuperAdminEmails });
    }
  }, [ensureUser, isAuthenticated, configuredSuperAdminEmails]);

  if (isPublicRoute) {
    return <Outlet />;
  }

  if (isLoading) {
    return (
      <PageContainer>
        <Stack gap="md">
          <SignedOutHeader wordmark="draft" />
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
          <SignedOutHeader wordmark="draft" />
          <Stack gap="md" maw={420} mx="auto">
            <Text c="dimmed">Sign in to view projections and draft.</Text>
            <AuthPanel />
          </Stack>
        </Stack>
      </PageContainer>
    );
  }

  return <Outlet />;
}
