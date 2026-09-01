import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

const espnFormatValidator = v.union(
  v.literal("standard"),
  v.literal("ppr"),
  v.literal("superflex"),
);
const ESPN_FORMATS = ["standard", "ppr", "superflex"] as const;

// Every ESPN standard-value row for a season, grouped by format - one call
// gets everything a caller needs regardless of which format their league
// resolves to (see src/lib/standardValues.ts's resolveStandardValueByFpid,
// which picks/blends the right one client-side, including averaging
// standard+ppr for HALF-scoring leagues, which have no ESPN format of their
// own). Bounded (a few thousand rows total across all three formats), so no
// pagination - same reasoning as getAllProjections/getAllRankings.
export const getStandardValues = query({
  args: { season: v.string() },
  handler: async (ctx, args) => {
    const result: Record<
      (typeof ESPN_FORMATS)[number],
      Array<{ fpid: number; rank: number; auctionValue: number }>
    > = { standard: [], ppr: [], superflex: [] };

    for (const format of ESPN_FORMATS) {
      const rows = await ctx.db
        .query("standardValues")
        .withIndex("by_platform_format_season_fpid", (q) =>
          q.eq("platform", "espn").eq("format", format).eq("season", args.season),
        )
        .collect();
      result[format] = rows.map((row) => ({
        fpid: row.fpid,
        rank: row.rank,
        auctionValue: row.auctionValue,
      }));
    }

    return result;
  },
});

// Upserts ESPN's draft-kit ranks for one format (see convex/espn/
// rankings.ts, which calls this once per format), which has already
// resolved each ESPN player down to an fpid (via players.espnId directly,
// or its name+position fallback match) before calling this - this mutation
// trusts that resolution rather than re-deriving it, so it costs one read
// (the existing-row lookup) plus a write per row instead of re-joining
// against players itself.
export const upsertEspnValues = internalMutation({
  args: {
    format: espnFormatValidator,
    season: v.string(),
    rows: v.array(
      v.object({
        fpid: v.number(),
        rank: v.number(),
        auctionValue: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    for (const row of args.rows) {
      const existing = await ctx.db
        .query("standardValues")
        .withIndex("by_platform_format_season_fpid", (q) =>
          q
            .eq("platform", "espn")
            .eq("format", args.format)
            .eq("season", args.season)
            .eq("fpid", row.fpid),
        )
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, {
          rank: row.rank,
          auctionValue: row.auctionValue,
          fetchedAt: now,
        });
      } else {
        await ctx.db.insert("standardValues", {
          platform: "espn",
          format: args.format,
          season: args.season,
          fpid: row.fpid,
          rank: row.rank,
          auctionValue: row.auctionValue,
          fetchedAt: now,
        });
      }
    }

    return { upserted: args.rows.length };
  },
});
