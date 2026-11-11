import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { requireSeasonViewer } from "../lib/access";

// requireSeasonViewer for actions, which can't read the database directly.
export const requireViewer = internalQuery({
  args: { seasonId: v.id("seasons") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    season: Doc<"seasons">;
    league: Doc<"leagues">;
    isCommissioner: boolean;
    teamIds: Id<"seasonTeams">[];
  }> => {
    const { season, league, isCommissioner, teamIds } = await requireSeasonViewer(
      ctx,
      args.seasonId,
    );
    return { season, league, isCommissioner, teamIds };
  },
});
