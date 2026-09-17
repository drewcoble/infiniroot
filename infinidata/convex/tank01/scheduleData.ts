import { v } from "convex/values";
import { internalMutation, query } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

// Split out from schedule.ts because that file is "use node" (the fetch
// call needs the Node runtime) and mutations can't live in a Node-runtime
// file - same split depthChartsData.ts/depthCharts.ts already use.
// Replace-all-on-sync for the (season, week), same pattern rosterPlayers/
// depth charts use - a whole week's slate (~16 games) is cheap to
// delete+reinsert and this only runs once/day.
export const upsertWeekSchedule = internalMutation({
  args: {
    season: v.string(),
    week: v.string(),
    games: v.array(
      v.object({
        homeTeam: v.string(),
        awayTeam: v.string(),
        kickoffAt: v.number(),
        estimatedEndAt: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("nflGames")
      .withIndex("by_season_week", (q) =>
        q.eq("season", args.season).eq("week", args.week),
      )
      .collect();
    for (const row of existing) {
      await ctx.db.delete(row._id);
    }
    for (const game of args.games) {
      await ctx.db.insert("nflGames", {
        season: args.season,
        week: args.week,
        ...game,
      });
    }
    return { upserted: args.games.length };
  },
});

// One week's game slate - convex/sleeper/transactions.ts's own only
// consumer, joining each dropped player's own NFL team against its game's
// estimatedEndAt for Sleeper's "After Games" waiver-clear rule.
export const listGamesForWeek = query({
  args: { season: v.string(), week: v.string() },
  handler: async (ctx, args): Promise<Doc<"nflGames">[]> => {
    return await ctx.db
      .query("nflGames")
      .withIndex("by_season_week", (q) =>
        q.eq("season", args.season).eq("week", args.week),
      )
      .collect();
  },
});
