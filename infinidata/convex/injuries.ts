import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const getInjuries = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("injuries").collect();
  },
});

export const upsertInjuries = mutation({
  args: {
    rows: v.array(
      v.object({
        fpid: v.number(),
        status: v.string(),
        statusShort: v.string(),
        injuryType: v.string(),
        comment: v.string(),
        irWeeks: v.array(v.number()),
        probabilityOfPlaying: v.union(v.number(), v.null()),
        practice1: v.union(v.string(), v.null()),
        practice2: v.union(v.string(), v.null()),
        practice3: v.union(v.string(), v.null()),
        practiceReportInjuryType: v.union(v.string(), v.null()),
        updatedAt: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("injuries").collect();
    const existingByFpid = new Map(existing.map((row) => [row.fpid, row]));
    const now = Date.now();
    const seen = new Set<number>();

    for (const row of args.rows) {
      seen.add(row.fpid);
      const match = existingByFpid.get(row.fpid);
      const fields = {
        status: row.status,
        statusShort: row.statusShort,
        injuryType: row.injuryType,
        comment: row.comment,
        irWeeks: row.irWeeks,
        probabilityOfPlaying: row.probabilityOfPlaying,
        practice1: row.practice1,
        practice2: row.practice2,
        practice3: row.practice3,
        practiceReportInjuryType: row.practiceReportInjuryType,
        updatedAt: row.updatedAt,
        fetchedAt: now,
      };

      if (match) {
        await ctx.db.patch(match._id, fields);
      } else {
        await ctx.db.insert("injuries", { fpid: row.fpid, ...fields });
      }
    }

    // Drop players who recovered/dropped off the API's currently-injured list
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
