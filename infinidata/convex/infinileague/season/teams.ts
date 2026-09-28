import { v } from "convex/values";
import { mutation } from "../../_generated/server";
import { requireDraftNotStarted } from "../../lib/access";
import { insertSeasonTeams } from "../../lib/seasonTeams";
import { resolveDraftType } from "../../draftType";

// infinileague's own version of infinidraft's initializeSeasonTeams
// (convex/infinidraft/draft/teams.ts) - trimmed to just what
// ConnectSleeperLeague.tsx/ConnectYahooLeague.tsx need (no manual-setup
// case; infinileague/infinifaab only ever bootstrap teams from a Sleeper or
// Yahoo league they're connecting to - infinifaab has no mutation of its
// own and calls this same one). Kept as its own thin mutation rather than
// sharing infinidraft's, so a future change to infinidraft's draft-day team
// setup flow can't break these apps' connect flows and vice versa - the
// actual row-insertion logic they share lives in convex/lib/seasonTeams.ts.
const sleeperLinkValidator = v.object({
  sleeperRosterId: v.string(),
  sleeperOwnerId: v.string(),
});

export const initializeSeasonTeams = mutation({
  args: {
    seasonId: v.id("seasons"),
    opponentNames: v.array(v.string()),
    selfName: v.string(),
    selfSleeperLink: v.optional(sleeperLinkValidator),
    opponentSleeperLinks: v.optional(
      v.array(v.union(sleeperLinkValidator, v.null())),
    ),
    selfYahooTeamKey: v.optional(v.string()),
    opponentYahooTeamKeys: v.optional(
      v.array(v.union(v.string(), v.null())),
    ),
  },
  handler: async (ctx, args) => {
    const { season, draft } = await requireDraftNotStarted(ctx, args.seasonId);

    const existing = await ctx.db
      .query("seasonTeams")
      .withIndex("by_season", (q) => q.eq("seasonId", args.seasonId))
      .first();
    if (existing) {
      throw new Error("Teams have already been set up for this league.");
    }

    if (args.opponentNames.length !== season.teamCount - 1) {
      throw new Error(
        `This league has ${season.teamCount} teams, so ${
          season.teamCount - 1
        } opponent names are required (got ${args.opponentNames.length}).`,
      );
    }

    return await insertSeasonTeams(ctx, {
      seasonId: args.seasonId,
      draftId: draft._id,
      draftType: resolveDraftType(season, draft),
      selfName: args.selfName,
      opponentNames: args.opponentNames,
      selfSleeperLink: args.selfSleeperLink,
      opponentSleeperLinks: args.opponentSleeperLinks,
      selfYahooTeamKey: args.selfYahooTeamKey,
      opponentYahooTeamKeys: args.opponentYahooTeamKeys,
    });
  },
});
