import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

// Single-row table (see schema.ts's nflState) - always patch the existing
// row if one exists rather than accumulating a history, since only the
// current value is ever read.
export const upsertNflState = internalMutation({
  args: {
    season: v.string(),
    week: v.string(),
    seasonType: v.union(
      v.literal("pre"),
      v.literal("regular"),
      v.literal("post"),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("nflState").first();
    const updatedAt = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { ...args, updatedAt });
    } else {
      await ctx.db.insert("nflState", { ...args, updatedAt });
    }
  },
});

export const getNflState = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("nflState").first();
  },
});
