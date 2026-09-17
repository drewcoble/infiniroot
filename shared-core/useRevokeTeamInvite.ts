import { useMutation } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { api } from "@infinidata/api";

export interface RevokeTeamInviteArgs {
  seasonId: Id<"seasons">;
  teamId: Id<"seasonTeams">;
}

export function useRevokeTeamInvite(): (
  args: RevokeTeamInviteArgs,
) => Promise<null> {
  return useMutation(api.infinileague.auction.invites.revokeTeamInvite);
}
