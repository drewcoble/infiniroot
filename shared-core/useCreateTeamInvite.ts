import { useMutation } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { api } from "@infinidata/api";

export interface CreateTeamInviteArgs {
  seasonId: Id<"seasons">;
  teamId: Id<"seasonTeams">;
}

// Regenerating an invite revokes any existing active one for this team
// first (see the backend's own comment) - the returned token is unused by
// callers today since listTeamInvites' next refresh picks up the new link.
export function useCreateTeamInvite(): (
  args: CreateTeamInviteArgs,
) => Promise<string> {
  return useMutation(api.infinileague.auction.invites.createTeamInvite);
}
