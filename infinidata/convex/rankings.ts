import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { positionValidator, POSITIONS } from "./positions";

export const getRankings = query({
  args: { position: positionValidator, week: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("rankings")
      .withIndex("by_position_week", (q) =>
        q.eq("position", args.position).eq("week", args.week),
      )
      .collect();

    return rows.sort((a, b) => a.adpPpr - b.adpPpr);
  },
});

// All 5 positions' rankings in one call, for the combined players table's
// overall-relevance (ADP) cutoff - mirrors getAllProjections.
export const getAllRankings = query({
  args: { week: v.string() },
  handler: async (ctx, args) => {
    const results = [];
    for (const position of POSITIONS) {
      const rows = await ctx.db
        .query("rankings")
        .withIndex("by_position_week", (q) =>
          q.eq("position", position).eq("week", args.week),
        )
        .collect();
      results.push(...rows);
    }
    return results;
  },
});

export const upsertRankings = mutation({
  args: {
    position: positionValidator,
    season: v.string(),
    week: v.string(),
    rows: v.array(
      v.object({
        fpid: v.number(),
        adpStd: v.number(),
        adpPpr: v.number(),
        adpHalf: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("rankings")
      .withIndex("by_position_week", (q) =>
        q.eq("position", args.position).eq("week", args.week),
      )
      .collect();

    const existingByFpid = new Map(existing.map((row) => [row.fpid, row]));
    const now = Date.now();
    const seen = new Set<number>();

    for (const row of args.rows) {
      seen.add(row.fpid);
      const match = existingByFpid.get(row.fpid);

      if (match) {
        await ctx.db.patch(match._id, {
          adpStd: row.adpStd,
          adpPpr: row.adpPpr,
          adpHalf: row.adpHalf,
          fetchedAt: now,
        });
      } else {
        await ctx.db.insert("rankings", {
          fpid: row.fpid,
          season: args.season,
          week: args.week,
          position: args.position,
          adpStd: row.adpStd,
          adpPpr: row.adpPpr,
          adpHalf: row.adpHalf,
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

// One-time migration - see projections.ts's renameDraftWeekToZero (same
// sentinel rename, same table shape, same paginated/self-rescheduling
// pattern). Safe to run more than once.
export const renameDraftWeekToZero = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("rankings")
      .paginate({ cursor: args.cursor ?? null, numItems: 500 });

    let renamed = 0;
    for (const row of result.page) {
      if (row.week === "draft") {
        await ctx.db.patch(row._id, { week: "0" });
        renamed += 1;
      }
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(0, internal.rankings.renameDraftWeekToZero, {
        cursor: result.continueCursor,
      });
    }

    return { renamed, isDone: result.isDone };
  },
});
