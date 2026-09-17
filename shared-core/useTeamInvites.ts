import { useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { api } from "@infinidata/api";

// Mirrors convex/infinileague/auction/invites.ts's TeamInviteRow.
export interface TeamInviteRow {
  teamId: string;
  teamName: string;
  token: string | null;
  members: Array<{ userId: string; name: string | null }>;
}

// Commissioner-only board of which teams have been invited/joined -
// listTeamInvites itself is requireSeasonOwner-gated, so `enabled` (the
// caller's own isCommissioner check) skips the call entirely rather than
// let a non-commissioner's query resolve to a rejection.
export function useTeamInvites(
  seasonId: Id<"seasons">,
  enabled: boolean,
): TeamInviteRow[] | undefined {
  const { isAuthenticated } = useConvexAuth();
  return useQuery(
    api.infinileague.auction.invites.listTeamInvites,
    isAuthenticated && enabled ? { seasonId } : "skip",
  );
}
