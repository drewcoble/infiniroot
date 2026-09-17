import { useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { api } from "@infinidata/api";
import type { CycleType } from "./CycleType";

// Mirrors convex/infinileague/auction/players.ts's WaiverPlayerRow.
// cycleId/closesAt are absent for a "weekly" row when no weekly cycle
// happens to be open right now - the player still shows, just isn't
// bid-able yet (see eligibility.ts's EligibleCycleRef comment).
export interface WaiverPlayerRow {
  fpid: number;
  name: string;
  team: string | null;
  position: "QB" | "RB" | "WR" | "TE" | "DST" | "K";
  rosRank: number;
  positionRank: number;
  rosPpg: number;
  actualPpg: number;
  rosteredByTeamName: null;
  injury?: { status: string; statusShort: string };
  cycleType: CycleType;
  cycleId?: string;
  closesAt?: number;
}

// infinifaab's Players tab - every currently-unowned, waiver-eligible
// player (see eligibility.ts's getEligibleFpidSet).
export function useWaiverEligiblePlayers(
  seasonId: Id<"seasons">,
): WaiverPlayerRow[] | undefined {
  const { isAuthenticated } = useConvexAuth();
  return useQuery(
    api.infinileague.auction.players.getWaiverEligiblePlayers,
    isAuthenticated ? { seasonId } : "skip",
  );
}
