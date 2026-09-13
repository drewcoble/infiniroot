import { useMutation } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { api } from "@infinidata/api";

export interface OpenAuctionCycleNowArgs {
  seasonId: Id<"seasons">;
  durationMinutes: number;
}

// Commissioner-only manual override of the weekly cycle schedule - only
// one open weekly cycle is ever allowed per season (rejected server-side
// if one's already open).
export function useOpenAuctionCycleNow(): (
  args: OpenAuctionCycleNowArgs,
) => Promise<Id<"faAuctionCycles">> {
  return useMutation(api.infinileague.auction.cycles.openAuctionCycleNow);
}
