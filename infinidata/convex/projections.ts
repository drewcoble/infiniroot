import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { positionValidator, POSITIONS } from "./positions";

export const getProjections = query({
  args: { position: positionValidator, week: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("projections")
      .withIndex("by_position_week", (q) =>
        q.eq("position", args.position).eq("week", args.week),
      )
      .collect();

    return rows.sort((a, b) => b.pointsPpr - a.pointsPpr);
  },
});

// All 5 positions' projections in one call, for the combined players table -
// avoids 5 separate subscriptions client-side. Unsorted; callers rank as needed.
export const getAllProjections = query({
  args: { week: v.string() },
  handler: async (ctx, args) => {
    const results = [];
    for (const position of POSITIONS) {
      const rows = await ctx.db
        .query("projections")
        .withIndex("by_position_week", (q) =>
          q.eq("position", position).eq("week", args.week),
        )
        .collect();
      results.push(...rows);
    }
    return results;
  },
});

export const upsertProjections = mutation({
  args: {
    position: positionValidator,
    season: v.string(),
    week: v.string(),
    rows: v.array(
      v.object({
        fpid: v.number(),
        name: v.string(),
        team: v.union(v.string(), v.null()),
        pointsStd: v.number(),
        pointsPpr: v.number(),
        pointsHalf: v.number(),
        stats: v.record(v.string(), v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("projections")
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
          name: row.name,
          team: row.team,
          pointsStd: row.pointsStd,
          pointsPpr: row.pointsPpr,
          pointsHalf: row.pointsHalf,
          // Stashed from this row's outgoing values, not looked up
          // separately - see schema.ts's previousPointsStd/Ppr/Half comment
          // for why this is a one-step lookback rather than full history.
          previousPointsStd: match.pointsStd,
          previousPointsPpr: match.pointsPpr,
          previousPointsHalf: match.pointsHalf,
          previousFetchedAt: match.fetchedAt,
          stats: row.stats,
          fetchedAt: now,
        });
      } else {
        await ctx.db.insert("projections", {
          fpid: row.fpid,
          season: args.season,
          week: args.week,
          position: args.position,
          name: row.name,
          team: row.team,
          pointsStd: row.pointsStd,
          pointsPpr: row.pointsPpr,
          pointsHalf: row.pointsHalf,
          stats: row.stats,
          fetchedAt: now,
        });
      }
    }

    // Drop players that disappeared from this position+week (e.g. off the
    // board) - but never a manually-added custom player (see
    // draft/customPlayers.ts's addCustomPlayer), identifiable by its always-
    // negative fpid. Those never come from Sleeper/ESPN, so they'd never be
    // in `seen` and would otherwise get pruned on every fetch.
    let removed = 0;
    for (const row of existing) {
      if (!seen.has(row.fpid) && row.fpid > 0) {
        await ctx.db.delete(row._id);
        removed += 1;
      }
    }

    return { upserted: args.rows.length, removed };
  },
});

// One-time migration: the app's season-long-dataset sentinel was renamed
// from the non-numeric "draft" to "0" (so it sorts/compares naturally
// alongside real week numbers "1"-"18") - this renames any rows still
// under the old value. Paginated + self-rescheduling like
// playerPoints.ts's backfillSeasonStats/clearSeasonStats, since this is a
// manually-triggered maintenance job, not a hot path. Safe to run more than
// once (a second run just finds nothing left to rename).
export const renameDraftWeekToZero = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("projections")
      .paginate({ cursor: args.cursor ?? null, numItems: 500 });

    let renamed = 0;
    for (const row of result.page) {
      if (row.week === "draft") {
        await ctx.db.patch(row._id, { week: "0" });
        renamed += 1;
      }
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.projections.renameDraftWeekToZero,
        {
          cursor: result.continueCursor,
        },
      );
    }

    return { renamed, isDone: result.isDone };
  },
});
