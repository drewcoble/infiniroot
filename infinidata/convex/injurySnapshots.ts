import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Only inserts a new row when a player's status actually differs from
// their most-recently-stored snapshot (regardless of week) - see the
// schema comment on injurySnapshots for why this is append-on-change
// rather than one-row-per-fetch or one-row-per-week. Called from
// convex/sleeper/projections.ts right after it upserts the live `injuries`
// table, reusing the same parsed rows.
export const recordSnapshots = mutation({
  args: {
    season: v.string(),
    week: v.string(),
    rows: v.array(
      v.object({
        fpid: v.number(),
        status: v.string(),
        statusShort: v.string(),
        injuryType: v.string(),
        comment: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let inserted = 0;

    for (const row of args.rows) {
      const latest = await ctx.db
        .query("injurySnapshots")
        .withIndex("by_fpid", (q) => q.eq("fpid", row.fpid))
        .order("desc")
        .first();

      const unchanged =
        latest &&
        latest.status === row.status &&
        latest.statusShort === row.statusShort &&
        latest.injuryType === row.injuryType;
      if (unchanged) continue;

      await ctx.db.insert("injurySnapshots", {
        fpid: row.fpid,
        season: args.season,
        week: args.week,
        status: row.status,
        statusShort: row.statusShort,
        injuryType: row.injuryType,
        comment: row.comment,
        fetchedAt: now,
      });
      inserted += 1;
    }

    return { inserted, checked: args.rows.length };
  },
});

// Every status change recorded for one player during one season - grouped
// by week client-side (src/components/PlayerSeasonGameLog.tsx) since a
// single week can have more than one change (see the schema comment).
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
