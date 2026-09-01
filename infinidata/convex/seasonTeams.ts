import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

// No-auth counterpart to infinidraft's listSeasonTeams (convex/infinidraft/
// draft/teams.ts), for server-side callers that have already checked
// ownership themselves - specifically convex/sleeper/league.ts's
// syncLeagueRoster action (used by both apps' roster-sync flows), which
// can't call the QueryCtx-typed requireSeasonOwner directly (actions only
// get ActionCtx) and already verified the caller owns this season via
// requireOwnedSeasonForSync before reaching this query. Kept shared at the
// root rather than under either app's slice since both apps' sync flows
// depend on it.
export const listSeasonTeamsInternal = internalQuery({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("seasonTeams")
      .withIndex("by_season", (q) => q.eq("seasonId", args.seasonId))
      .collect();
  },
});
