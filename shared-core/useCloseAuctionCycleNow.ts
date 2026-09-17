import { useMutation } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { api } from "@infinidata/api";

export interface CloseAuctionCycleNowArgs {
  seasonId: Id<"seasons">;
  cycleId?: Id<"faAuctionCycles">;
}

// cycleId omitted closes the season's open weekly cycle; passed explicitly
// to close a specific dedicated (playerDrop/manual) cycle instead.
export function useCloseAuctionCycleNow(): (
  args: CloseAuctionCycleNowArgs,
) => Promise<null> {
  return useMutation(api.infinileague.auction.cycles.closeAuctionCycleNow);
}
