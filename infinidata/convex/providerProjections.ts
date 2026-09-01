import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { positionValidator } from "./positions";

const providerValidator = v.union(v.literal("sleeper"), v.literal("espn"));

// Upserts one provider's raw per-category stats for a position/season/week -
// see convex/projectionBlending.ts, which reads across every provider's rows
// here to produce the app's actual projections. Mirrors projections.
// upsertProjections' upsert-and-remove-stragglers shape, scoped additionally
// by provider (filtered in memory rather than a dedicated index - one more
// key would make for a 5-field index for a table this small) so one
// provider's fetch never deletes another provider's rows for the same
// position/week.
export const upsertProviderProjections = mutation({
  args: {
    provider: providerValidator,
    position: positionValidator,
    season: v.string(),
    week: v.string(),
    rows: v.array(
      v.object({
        fpid: v.number(),
        stats: v.record(v.string(), v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existing = (
      await ctx.db
        .query("providerProjections")
        .withIndex("by_position_season_week", (q) =>
          q
            .eq("position", args.position)
            .eq("season", args.season)
            .eq("week", args.week),
        )
        .collect()
    ).filter((row) => row.provider === args.provider);

    const existingByFpid = new Map(existing.map((row) => [row.fpid, row]));
    const now = Date.now();
    const seen = new Set<number>();

    for (const row of args.rows) {
      seen.add(row.fpid);
      const match = existingByFpid.get(row.fpid);

      if (match) {
        await ctx.db.patch(match._id, { stats: row.stats, fetchedAt: now });
      } else {
        await ctx.db.insert("providerProjections", {
          provider: args.provider,
          season: args.season,
          week: args.week,
          position: args.position,
          fpid: row.fpid,
          stats: row.stats,
          fetchedAt: now,
        });
      }
    }

    let removed = 0;
    for (const row of existing) {
      if (!seen.has(row.fpid)) {
        await ctx.db.delete(row._id);
        removed += 1;
      }
    }

    return { upserted: args.rows.length, removed };
  },
});
