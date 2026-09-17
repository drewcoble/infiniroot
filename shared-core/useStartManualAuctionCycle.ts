import { useMutation } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { api } from "@infinidata/api";

export interface StartManualAuctionCycleArgs {
  seasonId: Id<"seasons">;
  fpids: number[];
  durationMinutes: number;
}

// Sleeper-only on the backend (rejects a Yahoo-linked season) - same
// caveat as useManualCycleCandidates.
export function useStartManualAuctionCycle(): (
  args: StartManualAuctionCycleArgs,
) => Promise<Id<"faAuctionCycles">> {
  return useMutation(api.infinileague.auction.cycles.startManualAuctionCycle);
}
