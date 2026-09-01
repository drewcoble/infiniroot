import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexQueryClient } from "@convex-dev/react-query";
import { MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { Analytics } from "@vercel/analytics/react";
import { ConvexReactClient } from "convex/react";
import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { routeTree } from "./routeTree.gen";
import { cssVariablesResolver, theme } from "@shared/theme";

const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;

if (!convexUrl) {
  throw new Error(
    "VITE_CONVEX_URL is not set. Copy .env.local.example to .env.local and " +
      "point it at the SAME Convex deployment infinidraft uses - see " +
      "INFINILEAGUE.md in the infinidraft repo.",
  );
}

const convex = new ConvexReactClient(convexUrl);

// Available for later use (e.g. TanStack Query's placeholderData semantics
// when a query's args change) - not wired to any query yet since this
// scaffold doesn't call any Convex functions. See infinidraft's main.tsx
// for the pattern this mirrors.
const convexQueryClient = new ConvexQueryClient(convex);
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryKeyHashFn: convexQueryClient.hashFn(),
      queryFn: convexQueryClient.queryFn(),
    },
  },
});
convexQueryClient.connect(queryClient);

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    {/* No custom `storage` here (unlike infinidraft's authCookieStorage) -
        that exists to share a session across *subdomains* of one registrable
        domain. infinileague.com and infinidraft.com are different
        registrable domains entirely, so cookie-domain sharing can't apply
        here regardless - each domain gets its own independent sign-in
        against the same underlying account (see INFINILEAGUE.md's "same
        account, separate sign-in" decision). shouldHandleCode={false} for
        the same reason as infinidraft: only the Password provider is
        configured, so there's no legitimate flow that puts a real sign-in
        `?code=` on this app's URLs. */}
    <ConvexAuthProvider client={convex} shouldHandleCode={false}>
      <QueryClientProvider client={queryClient}>
        <MantineProvider
          theme={theme}
          defaultColorScheme="dark"
          cssVariablesResolver={cssVariablesResolver}
        >
          <Analytics />
          <RouterProvider router={router} />
        </MantineProvider>
      </QueryClientProvider>
    </ConvexAuthProvider>
  </React.StrictMode>,
);
