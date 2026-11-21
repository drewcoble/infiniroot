import { useConvexAuth, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@infinidata/api";

export type YoffsSeason = FunctionReturnType<typeof api.infiniyoffs.leagues.listMySeasons>[number];

// Every league the signed-in user commissions or was invited into - the
// dashboard grid and AppHeader's league switcher.
export function useMySeasons(): YoffsSeason[] | undefined {
  const { isAuthenticated } = useConvexAuth();
  return useQuery(api.infiniyoffs.leagues.listMySeasons, isAuthenticated ? {} : "skip");
}
