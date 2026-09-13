import { useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { api } from "@infinidata/api";
import type { CycleType } from "./CycleType";

export interface AuctionCycle {
  _id: string;
  type?: CycleType;
  opensAt: number;
  closesAt: number;
  status: "open" | "closed";
}

// Mirrors convex/infinileague/auction/bids.ts's AuctionBoardRow.
export interface AuctionBoardRow {
  fpid: number;
  cycleId: string;
  cycleType: CycleType;
  closesAt: number;
  currentPrice: number;
  leadingTeamName: string | null;
  bidCount: number;
}

// The public board across every currently-open cycle (current price/
// leading team only, never any team's real max) plus the list of open
// cycles itself - the Players tab merges this against its own
// waiver-eligible player list and falls back to the season's startingBid
// for anything absent.
export function useAuctionBoardState(
  seasonId: Id<"seasons">,
): { openCycles: AuctionCycle[]; rows: AuctionBoardRow[] } | undefined {
  const { isAuthenticated } = useConvexAuth();
  return useQuery(
    api.infinileague.auction.bids.getAuctionBoardState,
    isAuthenticated ? { seasonId } : "skip",
  );
}
