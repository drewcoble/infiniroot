import { useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { api } from "@infinidata/api";

// Mirrors convex/infinileague/auction/bids.ts's AuctionDashboardRow.
export interface AuctionDashboardRow {
  teamId: string;
  teamName: string;
  faabRemaining: number;
  activeWinningBids: number;
}

// Team FAAB standings for a season's current auction cycle, already sorted
// FAAB-remaining descending by the backend (see
// api.infinileague.auction.bids.getAuctionDashboard) - skips the query
// until auth has resolved, same convention every Convex-backed hook in
// infinifaab follows.
export function useAuctionDashboard(
  seasonId: Id<"seasons">,
): AuctionDashboardRow[] | undefined {
  const { isAuthenticated } = useConvexAuth();
  return useQuery(
    api.infinileague.auction.bids.getAuctionDashboard,
    isAuthenticated ? { seasonId } : "skip",
  );
}
