import { useMutation } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { api } from "@infinidata/api";
import type { AuctionSettings } from "./useAuctionSettings";

// No timeZone field - the auction schedule always runs on Eastern Time
// now, not a per-league setting (see convex/infinileague/auction/
// settings.ts's AUCTION_TIME_ZONE) - updateAuctionSettings itself has no
// such arg to send.
export type UpdateAuctionSettingsArgs = Omit<AuctionSettings, "timeZone"> & {
  seasonId: Id<"seasons">;
};

export function useUpdateAuctionSettings(): (
  args: UpdateAuctionSettingsArgs,
) => Promise<null> {
  return useMutation(api.infinileague.auction.settings.updateAuctionSettings);
}
