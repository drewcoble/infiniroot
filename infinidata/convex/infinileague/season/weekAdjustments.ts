import { v } from "convex/values";
import { action, type ActionCtx } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import { loadYahooWeekScores, yahooAdjustments } from "../../infinidraft/yahoo/adjustments";
import { currentWeekFor } from "./playoffs";

// Points a Yahoo commissioner added to (or took off) each team's score for
// the week by hand (teamId -> points) - part of Yahoo's matchup score but
// not of any player's points, so the Matchup tab adds them to its starter
// totals. Empty for other platforms and for future weeks.
export const getWeekAdjustments = action({
  args: { seasonId: v.id("seasons"), week: v.string() },
  handler: async (ctx: ActionCtx, args): Promise<Record<string, number>> => {
    const { season, league } = await ctx.runQuery(internal.rosterSync.requireOwnedSeasonForSync, {
      seasonId: args.seasonId,
    });
    if (!season.yahooLeagueKey) return {};
    const [teams, nflState] = await Promise.all([
      ctx.runQuery(internal.seasonTeams.listSeasonTeamsInternal, { seasonId: args.seasonId }),
      ctx.runQuery(api.nflState.getNflState, {}),
    ]);
    const week = Number(args.week);
    const currentWeek = currentWeekFor(season, nflState);
    if (week > currentWeek) return {};

    const scores = await loadYahooWeekScores(ctx, season, league, teams, week, currentWeek);
    const adjustments = yahooAdjustments(scores);
    return Object.fromEntries(
      teams.flatMap((team) => {
        const adjustment = team.yahooTeamKey ? adjustments[team.yahooTeamKey] : undefined;
        return adjustment !== undefined ? [[team._id, adjustment]] : [];
      }),
    );
  },
});
