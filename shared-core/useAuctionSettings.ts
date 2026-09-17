import { useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { api } from "@infinidata/api";

// Mirrors convex/infinileague/auction/settings.ts's stored/default shape.
export interface AuctionSettings {
  enabled: boolean;
  closeWeekday: number;
  closeHour: number;
  closeMinute: number;
  timeZone: string;
  minIncrement: number;
  startingBid: number;
  antiSnipeMinutes: number;
  tieBreakMode: "earliest" | "waiverOrder";
  dropCycleDurationHours: number;
}

// Any season participant can read these (closesAt/tieBreakMode context for
// the boards) - only the commissioner-only mutation (settings.ts's
// updateAuctionSettings) is access-restricted, not this read.
export function useAuctionSettings(
  seasonId: Id<"seasons">,
): AuctionSettings | undefined {
  const { isAuthenticated } = useConvexAuth();
  return useQuery(
    api.infinileague.auction.settings.getAuctionSettings,
    isAuthenticated ? { seasonId } : "skip",
  );
}
