import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexQueryClient } from "@convex-dev/react-query";
import { MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
import "@mantine/charts/styles.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { Analytics } from "@vercel/analytics/react";
import { ConvexReactClient } from "convex/react";
import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { authCookieStorage } from "./lib/authStorage";
import { routeTree } from "./routeTree.gen";
import { cssVariablesResolver, theme } from "@shared/theme";

const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;

if (!convexUrl) {
  throw new Error(
    "VITE_CONVEX_URL is not set. Copy .env.local.example to .env.local and fill it in " +
      "(the URL is printed when you run `npx convex dev`).",
  );
}

const convex = new ConvexReactClient(convexUrl);

// Lets components use TanStack Query's useQuery (via convexQuery()) for
// Convex queries where its caching semantics - especially
// placeholderData/isFetching - are useful, e.g. keeping a table's previous
// results visible while its args change instead of flashing to a loading
// state. Still backed by Convex's live/reactive subscriptions under the hood.
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
    {/* shouldHandleCode={false}: by default @convex-dev/auth's client
        automatically tries to consume a `?code=` URL query param as one of
        its own OAuth/magic-link sign-in codes on every mount - this app
        only configures the Password provider (see convex/auth.ts), so
        there's no legitimate flow that ever puts a real one there. Left at
        the default, an unrelated `code` param from anywhere else (e.g. a
        redirect back from this domain's Vercel deployment-protection SSO
        wall) gets misread as a bogus sign-in attempt on every fresh load,
        with no credentials ever entered - this is what was actually
        causing the "must be signed in" crash loop on develop.infinidraft.com,
        not anything about stale stored tokens. */}
    {/* storage={authCookieStorage}: undefined today (falls back to the
        library's own localStorage default) everywhere until the
        www/auction/snake subdomain split ships and sets
        VITE_AUTH_COOKIE_DOMAIN - see src/lib/authStorage.ts and
        SNAKE_DRAFT.md §5.4 for why a session needs to be readable across
        subdomains rather than trapped on whichever one signed in. */}
    <ConvexAuthProvider
      client={convex}
      shouldHandleCode={false}
      {...(authCookieStorage ? { storage: authCookieStorage } : {})}
    >
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
