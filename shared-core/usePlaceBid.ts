import { useMutation } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { api } from "@infinidata/api";

export interface PlaceBidArgs {
  seasonId: Id<"seasons">;
  teamId: Id<"seasonTeams">;
  fpid: number;
  maxBid: number;
}

// BidModal's own submit-lifecycle (loading/error state) stays local to the
// component - this just keeps the mutation reference itself out of view
// code, same as every query hook here.
export function usePlaceBid(): (args: PlaceBidArgs) => Promise<null> {
  return useMutation(api.infinileague.auction.bids.placeBid);
}
