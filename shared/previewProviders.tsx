import type { ReactNode } from "react";
import { ConvexReactClient } from "convex/react";
import { createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";

// design-sync preview only - gives AuthPanel/AppHeader/ConnectSleeperLeague
// a real ConvexReactClient so their useConvexAuth/useQuery hooks resolve
// past "loading" instead of rendering blank. Points at the same deployment
// infinidraft's own main.tsx uses (see VITE_CONVEX_URL) - read-only,
// unauthenticated queries only, same as any signed-out visitor's browser.
export const previewConvexClient = new ConvexReactClient(
  "https://patient-vulture-800.convex.cloud",
);

// design-sync preview only - AppHeader/BottomNav/SignedOutHeader use
// @tanstack/react-router's Link/useNavigate, which need a real router
// context. RouterProvider owns rendering (it doesn't accept a plain
// `children` prop like a normal context provider), so this builds a
// throwaway single-route router whose root route renders whatever's
// passed in, rather than threading it through cfg.provider (which assumes
// providers that accept children).
export function PreviewRouter({ children }: { children: ReactNode }) {
  const rootRoute = createRootRoute({ component: () => children });
  const router = createRouter({ routeTree: rootRoute });
  void router.load();
  return <RouterProvider router={router} />;
}
