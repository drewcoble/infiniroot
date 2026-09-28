import { v } from "convex/values";
import { query } from "./_generated/server";

// Written only by convex/injuries.ts's applyInjuryFetch (see the schema
// comment on injurySnapshots for the three row kinds).

// Every snapshot recorded for one player during one season - grouped by
// week client-side (src/components/PlayerSeasonGameLog.tsx) since a single
// week can have more than one row (see the schema comment).
export const getSeasonSnapshots = query({
  args: { fpid: v.number(), season: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("injurySnapshots")
      .withIndex("by_fpid_season", (q) =>
        q.eq("fpid", args.fpid).eq("season", args.season),
      )
      .collect();
  },
});
