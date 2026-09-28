import { useMutation } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { api } from "@infinidata/api";

// Quick on/off counterpart to useUpdateAuctionSettings, for the dashboard
// league card's "Enable auction" action - lets a commissioner flip this on
// (or off) without opening the full Settings tab.
export function useSetAuctionEnabled(): (args: {
  seasonId: Id<"seasons">;
  enabled: boolean;
}) => Promise<null> {
  return useMutation(api.infinileague.auction.settings.setAuctionEnabled);
}
