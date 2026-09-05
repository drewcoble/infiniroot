import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";

// Replace-all-on-sync per season, same pattern rosterPlayers uses (see
// schema.ts's waiverPlayers comment) - simpler than diffing adds/clears,
// and this only runs on a periodic cron, not per-request. clearsAt absent
// means "Yahoo poll says still on waivers, exact clear time unknown" (see
// convex/infinidraft/yahoo/waivers.ts); present means a real computed
// Sleeper clear time (see convex/sleeper/transactions.ts).
export const replaceWaiverPlayersForSeason = internalMutation({
  args: {
    seasonId: v.id("seasons"),
    rows: v.array(
      v.object({ fpid: v.number(), clearsAt: v.optional(v.number()) }),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("waiverPlayers")
      .withIndex("by_season", (q) => q.eq("seasonId", args.seasonId))
      .collect();
    for (const row of existing) {
      await ctx.db.delete(row._id);
    }

    const now = Date.now();
    for (const row of args.rows) {
      await ctx.db.insert("waiverPlayers", {
        seasonId: args.seasonId,
        fpid: row.fpid,
        ...(row.clearsAt !== undefined ? { clearsAt: row.clearsAt } : {}),
        syncedAt: now,
      });
    }
    return { upserted: args.rows.length };
  },
});
