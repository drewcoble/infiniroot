import { v } from "convex/values";
import { action, type ActionCtx } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import { evaluate, weekBonuses } from "../../lib/playoffRules/evaluate";
import { EMPTY_DRAFT, stageWeeks } from "../../lib/playoffRules/format";
import { loadSeasonSchedule } from "../../infiniyoffs/season";
import { loadWeeklyPoints } from "../../infiniyoffs/scores";
import { currentWeekFor } from "./playoffs";

// Each team's infiniyoffs stage bonus for one week (teamId -> points) - a
// league with custom playoff rules can add tier or seed bonuses to its
// playoff scores, which the platform's own scores don't carry. Empty for a
// league with no custom rules, or a week no bonus stage plays.
export const getWeekBonuses = action({
  args: { seasonId: v.id("seasons"), week: v.string() },
  handler: async (ctx: ActionCtx, args): Promise<Record<string, number>> => {
    const { season, league } = await ctx.runQuery(internal.rosterSync.requireOwnedSeasonForSync, {
      seasonId: args.seasonId,
    });
    const format = await ctx.runQuery(internal.infiniyoffs.season.getFormatInternal, {
      seasonId: args.seasonId,
    });
    const week = Number(args.week);
    if (!format?.stages.some((stage) => stage.bonus && stageWeeks(stage).includes(week))) {
      return {};
    }

    const [teams, nflState] = await Promise.all([
      ctx.runQuery(internal.seasonTeams.listSeasonTeamsInternal, { seasonId: args.seasonId }),
      ctx.runQuery(api.nflState.getNflState, {}),
    ]);
    const currentWeek = currentWeekFor(season, nflState);
    const pastSeason = nflState !== null && Number(season.year) < Number(nflState.season);
    const draftStage = format.stages.find(
      (stage) => stage.kind === "groups" && stage.formation.kind === "matchupDraft",
    );
    // Tiers come from the regular season and who's in a bracket round
    // from every earlier week's result - points through this week do.
    const [{ upcoming, schedule }, points, draft] = await Promise.all([
      loadSeasonSchedule(ctx, season, league, teams, currentWeek),
      loadWeeklyPoints(ctx, season, league, teams, currentWeek, Math.min(currentWeek, week)),
      draftStage
        ? ctx.runQuery(internal.infiniyoffs.season.getDraftStateInternal, {
            seasonId: args.seasonId,
            stageId: draftStage.id,
          })
        : Promise.resolve(EMPTY_DRAFT),
    ]);
    const state = evaluate(format, {
      teamIds: teams.map((team) => team._id),
      schedule,
      medianGame: upcoming.medianGame,
      points,
      finalThroughWeek: pastSeason ? 18 : currentWeek - 1,
      draft,
    });
    return weekBonuses(format, state, week);
  },
});
