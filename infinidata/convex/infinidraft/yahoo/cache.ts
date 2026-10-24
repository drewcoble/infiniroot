import { v } from "convex/values";
import { internalMutation, internalQuery, type ActionCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";

// Short-lived cache for Yahoo reads that barely change but were refetched on
// every page load and live refresh - a league's DST scoring (from its
// settings), each team's weekly opponent (from the scoreboard), and every
// provider's league schedule (infinileague/season/schedule.ts). Yahoo
// throttles with HTTP 999 (see client.ts's fetchYahooApi), so cutting
// repeat requests matters more here than for Sleeper/ESPN. See schema.ts's
// yahooCache.

export const getCached = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("yahooCache")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
  },
});

export const setCached = internalMutation({
  args: { key: v.string(), data: v.any() },
  handler: async (ctx, args) => {
    const fetchedAt = Date.now();
    const existing = await ctx.db
      .query("yahooCache")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { data: args.data, fetchedAt });
    } else {
      await ctx.db.insert("yahooCache", { key: args.key, data: args.data, fetchedAt });
    }
  },
});

// `load`'s result for `key`, from the cache while it's younger than
// `maxAgeMs`, else freshly loaded and stored. If the load fails (Yahoo
// throttling us, say) and there's an older cached value, that's returned
// instead of the error - stale scoring tiers or a stale opponent beat an
// error box. `load`'s result must be Convex-storable (plain JSON-ish data).
export async function cachedYahoo<T>(
  ctx: ActionCtx,
  key: string,
  maxAgeMs: number,
  load: () => Promise<T>,
): Promise<T> {
  const cached = await ctx.runQuery(internal.infinidraft.yahoo.cache.getCached, { key });
  if (cached && Date.now() - cached.fetchedAt < maxAgeMs) return cached.data as T;
  try {
    const data = await load();
    await ctx.runMutation(internal.infinidraft.yahoo.cache.setCached, { key, data });
    return data;
  } catch (error) {
    if (cached) {
      console.warn(`cachedYahoo: load failed for ${key}, serving the stale value`, error);
      return cached.data as T;
    }
    throw error;
  }
}
