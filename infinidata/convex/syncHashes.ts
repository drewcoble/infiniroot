import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

// Fingerprints of what a sync last wrote (see syncHashes' schema comment).
// Keys are "<what>|<season>|<week>", e.g. "playerWeekPoints|2026|7".

export const getHashes = internalQuery({
  args: { keys: v.array(v.string()) },
  handler: async (ctx, args): Promise<Record<string, string>> => {
    const hashes: Record<string, string> = {};
    for (const key of args.keys) {
      const row = await ctx.db
        .query("syncHashes")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique();
      if (row) hashes[key] = row.hash;
    }
    return hashes;
  },
});

export const setHash = internalMutation({
  args: { key: v.string(), hash: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("syncHashes")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (existing) {
      if (existing.hash !== args.hash) await ctx.db.patch(existing._id, { hash: args.hash, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("syncHashes", { ...args, updatedAt: Date.now() });
    }
  },
});
