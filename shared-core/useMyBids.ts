import { useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { api } from "@infinidata/api";
import type { CycleType } from "./CycleType";

// Mirrors convex/infinileague/auction/bids.ts's MyBidRow.
export interface MyBidRow {
  fpid: number;
  cycleId: string;
  cycleType: CycleType;
  closesAt: number;
  teamId: string;
  teamName: string;
  maxBid: number;
}

// The signed-in user's own outstanding max bids across every currently-open
// cycle - private to them, never another team's bid.
export function useMyBids(seasonId: Id<"seasons">): MyBidRow[] | undefined {
  const { isAuthenticated } = useConvexAuth();
  return useQuery(
    api.infinileague.auction.bids.getMyBids,
    isAuthenticated ? { seasonId } : "skip",
  );
}
