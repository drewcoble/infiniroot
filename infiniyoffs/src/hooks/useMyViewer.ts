import { useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { api } from "@infinidata/api";

// Commissioner or member, and which team(s) are mine - see
// api.infiniyoffs.leagues.getMyViewer.
export function useMyViewer(seasonId: Id<"seasons">) {
  const { isAuthenticated } = useConvexAuth();
  return useQuery(api.infiniyoffs.leagues.getMyViewer, isAuthenticated ? { seasonId } : "skip");
}
