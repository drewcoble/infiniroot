import { v } from "convex/values";
import { action, internalQuery, query, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { requireSeasonViewer } from "../lib/access";
import { positionValidator } from "../positions";
import { rosVorBoardFor, weekPointsFor } from "../rosVor";
import { standingsFor } from "../infinileague/season/standings";
import { matchupDifficultyFor } from "../infinileague/season/matchupDifficulty";
import { weekPositionRanksFor } from "../infinileague/season/matchup";
import { gameLogFor, gameLogSeasonsFor } from "../infinileague/season/gameLog";
import { usageWeeksFor } from "../infinileague/season/usage";
import { loadTeamRosterForWeek, type TeamRosterRow } from "../infinileague/season/teamRoster";

// League members' copies of the reads behind infinileague's matchup and
// player screens - same args and results as the owner-gated originals
// (which they share their logic with), so the shared UI (shared/league)
// takes either set. See CONVENTIONS.md's "duplication over coupling".

export const getStandings = query({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args) => {
    const { season, teamIds } = await requireSeasonViewer(ctx, args.seasonId);
    return await standingsFor(ctx, season, (team) => teamIds.includes(team._id));
  },
});

export const getRosVorBoard = query({
  args: {
    seasonId: v.id("seasons"),
    week: v.string(),
    position: v.optional(positionValidator),
    teamId: v.optional(v.id("seasonTeams")),
  },
  handler: async (ctx, args) => {
    const { season } = await requireSeasonViewer(ctx, args.seasonId);
    return await rosVorBoardFor(ctx, season, args);
  },
});

export const getWeekPoints = query({
  args: { seasonId: v.id("seasons"), week: v.string() },
  handler: async (ctx, args) => {
    await requireSeasonViewer(ctx, args.seasonId);
    return await weekPointsFor(ctx, args);
  },
});

export const getWeekPositionRanks = query({
  args: { seasonId: v.id("seasons"), week: v.string() },
  handler: async (ctx, args) => {
    const { season } = await requireSeasonViewer(ctx, args.seasonId);
    return await weekPositionRanksFor(ctx, season, args);
  },
});

export const getMatchupDifficulty = query({
  args: { seasonId: v.id("seasons"), week: v.string() },
  handler: async (ctx, args) => {
    const { season } = await requireSeasonViewer(ctx, args.seasonId);
    return await matchupDifficultyFor(ctx, season, args);
  },
});

export const getGameLog = query({
  args: { seasonId: v.id("seasons"), fpid: v.number(), year: v.string() },
  handler: async (ctx, args) => {
    const { season } = await requireSeasonViewer(ctx, args.seasonId);
    return await gameLogFor(ctx, season, args);
  },
});

export const getGameLogSeasons = query({
  args: { seasonId: v.id("seasons"), fpid: v.number() },
  handler: async (ctx, args) => {
    const { season } = await requireSeasonViewer(ctx, args.seasonId);
    return await gameLogSeasonsFor(ctx, season, args);
  },
});

export const getUsageWeeks = query({
  args: { seasonId: v.id("seasons"), fpid: v.number(), year: v.string() },
  handler: async (ctx, args) => {
    const { season } = await requireSeasonViewer(ctx, args.seasonId);
    return await usageWeeksFor(ctx, season, args);
  },
});

// requireOwnedTeamForRead's counterpart: any team in a league the caller
// can view.
export const requireTeamViewer = internalQuery({
  args: { teamId: v.id("seasonTeams") },
  handler: async (
    ctx,
    args,
  ): Promise<{ team: Doc<"seasonTeams">; season: Doc<"seasons">; league: Doc<"leagues"> }> => {
    const team = await ctx.db.get(args.teamId);
    if (!team) throw new Error("Team not found.");
    const { season, league } = await requireSeasonViewer(ctx, team.seasonId);
    return { team, season, league };
  },
});

export const getTeamRosterForWeek = action({
  args: { teamId: v.id("seasonTeams"), week: v.string() },
  handler: async (ctx: ActionCtx, args): Promise<TeamRosterRow[]> => {
    const viewed = await ctx.runQuery(internal.infiniyoffs.reads.requireTeamViewer, {
      teamId: args.teamId,
    });
    return await loadTeamRosterForWeek(ctx, viewed, args.week);
  },
});

// Every team's lineup for the week, for the League view's score cards -
// pairings come from the rules engine in the browser, not the platform.
export const getWeekLineups = action({
  args: { seasonId: v.id("seasons"), week: v.string() },
  handler: async (
    ctx: ActionCtx,
    args,
  ): Promise<{ teamId: Id<"seasonTeams">; rows: TeamRosterRow[] }[]> => {
    const { season, league } = await ctx.runQuery(internal.infiniyoffs.access.requireViewer, {
      seasonId: args.seasonId,
    });
    const teams = await ctx.runQuery(internal.seasonTeams.listSeasonTeamsInternal, {
      seasonId: args.seasonId,
    });
    return await Promise.all(
      teams.map(async (team) => ({
        teamId: team._id,
        rows: await loadTeamRosterForWeek(ctx, { team, season, league }, args.week),
      })),
    );
  },
});
