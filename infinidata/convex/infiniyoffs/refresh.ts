import { v } from "convex/values";
import { action, internalMutation, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { runSleeperRosterSync } from "../sleeper/league";
import { runYahooRosterSync } from "../infinidraft/yahoo/league";
import { runEspnRosterSync } from "../espn/league";

// Rosters, names and records come from the roster sync, which only the
// commissioner can run in infinileague - so a member's visit here runs it
// too, at most once per window per league.
const REFRESH_WINDOW_MS = 15 * 60 * 1000;

// Claims this window's refresh - false if someone already started one, so
// a league full of members opening the app at once syncs once.
export const claimRefresh = internalMutation({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args): Promise<boolean> => {
    const now = Date.now();
    const settings = await ctx.db
      .query("playoffSettings")
      .withIndex("by_season", (q) => q.eq("seasonId", args.seasonId))
      .unique();
    const startedAt = settings?.refreshStartedAt;
    if (startedAt !== undefined && now - startedAt < REFRESH_WINDOW_MS) return false;
    if (settings) await ctx.db.patch(settings._id, { refreshStartedAt: now });
    else await ctx.db.insert("playoffSettings", { seasonId: args.seasonId, refreshStartedAt: now });
    return true;
  },
});

// Syncs the league's rosters if nobody has in the last window. Returns
// whether it ran, so the page knows to reload its data.
export const refreshIfStale = action({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx: ActionCtx, args): Promise<boolean> => {
    const { season, league } = await ctx.runQuery(internal.infiniyoffs.access.requireViewer, {
      seasonId: args.seasonId,
    });
    if (!(await ctx.runMutation(internal.infiniyoffs.refresh.claimRefresh, args))) return false;
    if (season.sleeperLeagueId) await runSleeperRosterSync(ctx, season);
    else if (season.yahooLeagueKey) await runYahooRosterSync(ctx, season, league);
    else if (season.espnLeagueId) await runEspnRosterSync(ctx, season);
    return true;
  },
});
