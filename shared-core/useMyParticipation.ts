import { useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { api } from "@infinidata/api";

// Mirrors convex/infinileague/auction/participant.ts's MyParticipation.
export interface MyParticipation {
  isCommissioner: boolean;
  teams: Array<{ teamId: string; name: string }>;
}

// Which of this season's teams the signed-in user can bid as - every
// FAAB-tab that needs to know "am I allowed to bid, and as which team(s)"
// reads this same hook rather than each re-deriving it.
export function useMyParticipation(
  seasonId: Id<"seasons">,
): MyParticipation | undefined {
  const { isAuthenticated } = useConvexAuth();
  return useQuery(
    api.infinileague.auction.participant.getMyParticipation,
    isAuthenticated ? { seasonId } : "skip",
  );
}
