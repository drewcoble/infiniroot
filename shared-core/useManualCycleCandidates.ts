import { useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { api } from "@infinidata/api";

// Mirrors convex/infinileague/auction/players.ts's ManualCycleCandidateRow -
// the commissioner-only picker for startManualAuctionCycle, deliberately
// wider than WaiverPlayerRow (no kickoff gate). Sleeper-only on the backend
// (listManualCycleCandidates returns [] for a Yahoo-linked season) - this
// hook doesn't special-case that, it just reflects whatever comes back.
export interface ManualCycleCandidateRow {
  fpid: number;
  name: string;
  team: string | null;
  position: "QB" | "RB" | "WR" | "TE" | "DST" | "K";
  rosRank: number;
  positionRank: number;
  rosPpg: number;
  actualPpg: number;
  injury?: { status: string; statusShort: string };
}

// Commissioner-only, same enabled-gating convention as useTeamInvites -
// listManualCycleCandidates is requireSeasonOwner-gated.
export function useManualCycleCandidates(
  seasonId: Id<"seasons">,
  enabled: boolean,
): ManualCycleCandidateRow[] | undefined {
  const { isAuthenticated } = useConvexAuth();
  return useQuery(
    api.infinileague.auction.players.listManualCycleCandidates,
    isAuthenticated && enabled ? { seasonId } : "skip",
  );
}
