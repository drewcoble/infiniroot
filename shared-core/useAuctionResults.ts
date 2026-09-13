import { useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { api } from "@infinidata/api";

// Mirrors convex/infinileague/auction/cycles.ts's AuctionResultRow.
export interface AuctionResultRow {
  cycleId: string;
  closesAt: number;
  fpid: number;
  playerName: string | null;
  winnerTeamName: string | null;
  price: number | null;
}

// Every closed auction cycle's results for a season, flat (one row per
// fpid) - the Results tab groups these by cycleId itself.
export function useAuctionResults(
  seasonId: Id<"seasons">,
): AuctionResultRow[] | undefined {
  const { isAuthenticated } = useConvexAuth();
  return useQuery(
    api.infinileague.auction.cycles.listResults,
    isAuthenticated ? { seasonId } : "skip",
  );
}
