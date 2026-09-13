import { useMutation } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { api } from "@infinidata/api";

export interface RemoveTeamMemberArgs {
  seasonId: Id<"seasons">;
  teamId: Id<"seasonTeams">;
  userId: Id<"users">;
}

export function useRemoveTeamMember(): (
  args: RemoveTeamMemberArgs,
) => Promise<null> {
  return useMutation(api.infinileague.auction.invites.removeTeamMember);
}
