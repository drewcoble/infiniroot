import { useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { api } from "@infinidata/api";
import type { CycleType } from "./CycleType";

// Mirrors convex/infinileague/auction/bids.ts's BidBoardRow - extends
// PlayerDisplayInfo so this satisfies @shared/PlayerCard's PlayerCardRow
// directly (the Bids tab renders the same PlayerCard the Players tab does).
export interface BidBoardRow {
  fpid: number;
  cycleId: string;
  cycleType: CycleType;
  closesAt: number;
  name: string;
  position: "QB" | "RB" | "WR" | "TE" | "DST" | "K";
  team: string | null;
  rosRank: number;
  positionRank: number;
  rosPpg: number;
  actualPpg: number;
  rosteredByTeamName: null;
  injury?: { status: string; statusShort: string };
  currentPrice: number;
  leadingTeamName: string | null;
  bidCount: number;
  myMaxBid: number | null;
  myTeamName: string | null;
  category: "winning" | "outbid" | "other";
}

// Every active bid this cycle across the whole league, pre-grouped
// winning/outbid/other and pre-sorted by price then rank within each group
// by the backend - the My Bids tab just renders these three sections.
export function useBidsBoard(
  seasonId: Id<"seasons">,
): BidBoardRow[] | undefined {
  const { isAuthenticated } = useConvexAuth();
  return useQuery(
    api.infinileague.auction.bids.getBidsBoard,
    isAuthenticated ? { seasonId } : "skip",
  );
}
