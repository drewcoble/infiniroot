import { v } from "convex/values";
import { internalQuery } from "../../_generated/server";

// Nullable, no-auth counterpart to requireRealDraft (see convex/lib/access.ts) - for
// convex/fetchAllData.ts's daily cache-refresh loop, which runs as a
// super-admin action over every season regardless of owner and should just
// skip a season with no real draft yet (mid-creation, or a data anomaly)
// rather than throwing and aborting the whole daily refresh.
export const getRealDraftInternal = internalQuery({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("drafts")
      .withIndex("by_season_kind", (q) =>
        q.eq("seasonId", args.seasonId).eq("kind", "real"),
      )
      .first();
  },
});
