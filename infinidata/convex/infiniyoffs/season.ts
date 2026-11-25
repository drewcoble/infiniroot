import { v } from "convex/values";
import { action, internalMutation, internalQuery, type ActionCtx } from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { loadLeagueSchedule, loadWeekPairs } from "../infinileague/season/schedule";
import {
  computeTeamWeekTotals,
  gatherPowerRankingsInputsFor,
} from "../infinileague/season/powerRankings";
import { currentWeekFor, loadPlayoffs, type LeaguePlayoffs } from "../infinileague/season/playoffs";
import { evaluate } from "../lib/playoffRules/evaluate";
import {
  EMPTY_DRAFT,
  stageWeeks,
  type DraftState,
  type PlayoffFormat,
} from "../lib/playoffRules/format";
import { loadWeeklyPoints } from "./scores";

export interface YoffsTeam {
  teamId: Id<"seasonTeams">;
  name: string;
  logoUrl?: string;
  isMine: boolean;
}

// Everything the league's pages score the playoffs from - the browser runs
// the rules engine (convex/lib/playoffRules) on it for the current picture,
// what-ifs and odds, so none of that costs a server round trip.
export interface SeasonData {
  teams: YoffsTeam[];
  isCommissioner: boolean;
  currentWeek: number;
  // Weeks through here are final.
  finalThroughWeek: number;
  // The platform's own settings - the default when no custom format is set.
  platformRegularSeasonEndWeek: number;
  medianGame: boolean;
  schedule: { weeks: number[]; teamIds: [Id<"seasonTeams">, Id<"seasonTeams">] }[];
  // Actual points (final, and live this week): teamId -> week -> points.
  points: Record<string, Record<number, number>>;
  // Optimal-lineup projections for this week on: teamId -> week -> points.
  projected: Record<string, Record<number, number>>;
  // The platform's bracket - only when the league has no custom format.
  platformPlayoffs: LeaguePlayoffs | null;
}

const LAST_WEEK = 18;

function lastFormatWeek(format: PlayoffFormat): number {
  const weeks = format.stages.flatMap(stageWeeks);
  return Math.max(format.regularSeasonEndWeek, ...weeks);
}

export const getFormatInternal = internalQuery({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args): Promise<PlayoffFormat | null> => {
    const settings = await ctx.db
      .query("playoffSettings")
      .withIndex("by_season", (q) => q.eq("seasonId", args.seasonId))
      .unique();
    return (settings?.format as PlayoffFormat | undefined) ?? null;
  },
});

// The format's recorded matchup draft, if it has one (one per league).
export const getDraftStateInternal = internalQuery({
  args: { seasonId: v.id("seasons"), stageId: v.string() },
  handler: async (ctx, args): Promise<DraftState> => {
    const row = await ctx.db
      .query("playoffDrafts")
      .withIndex("by_season_stage", (q) =>
        q.eq("seasonId", args.seasonId).eq("stageId", args.stageId),
      )
      .unique();
    if (!row) return EMPTY_DRAFT;
    const strip = ({ drafterId, opponentId, week }: (typeof row.picks)[number]) => ({
      drafterId,
      opponentId,
      week,
    });
    return { slots: row.slots, picks: row.picks.map(strip), rematches: row.rematches.map(strip) };
  },
});

// Creates a stage's draft row once its drafters are known - idempotent.
export const ensureDraft = internalMutation({
  args: {
    seasonId: v.id("seasons"),
    stageId: v.string(),
    drafterIds: v.array(v.id("seasonTeams")),
    poolIds: v.array(v.id("seasonTeams")),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("playoffDrafts")
      .withIndex("by_season_stage", (q) =>
        q.eq("seasonId", args.seasonId).eq("stageId", args.stageId),
      )
      .unique();
    if (existing) return;
    await ctx.db.insert("playoffDrafts", { ...args, slots: [], picks: [], rematches: [] });
  },
});

export const getSeasonData = action({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx: ActionCtx, args): Promise<SeasonData> => {
    const { season, league, isCommissioner, teamIds: myTeamIds } = await ctx.runQuery(
      internal.infiniyoffs.access.requireViewer,
      { seasonId: args.seasonId },
    );
    const [teams, nflState, format] = await Promise.all([
      ctx.runQuery(internal.seasonTeams.listSeasonTeamsInternal, { seasonId: args.seasonId }),
      ctx.runQuery(api.nflState.getNflState, {}),
      ctx.runQuery(internal.infiniyoffs.season.getFormatInternal, { seasonId: args.seasonId }),
    ]);
    const currentWeek = currentWeekFor(season, nflState);
    const pastSeason = nflState !== null && Number(season.year) < Number(nflState.season);
    const lastWeek = Math.min(format ? lastFormatWeek(format) : LAST_WEEK, LAST_WEEK);

    const { upcoming, schedule } = await loadSeasonSchedule(
      ctx,
      season,
      league,
      teams,
      currentWeek,
    );

    const [points, projected, platformPlayoffs] = await Promise.all([
      loadWeeklyPoints(ctx, season, league, teams, currentWeek, Math.min(currentWeek, lastWeek)),
      pastSeason ? Promise.resolve({}) : loadProjected(ctx, season),
      format ? Promise.resolve(null) : loadPlayoffs(ctx, season, league, teams, currentWeek),
    ]);
    const finalThroughWeek = pastSeason ? LAST_WEEK : currentWeek - 1;

    if (format) {
      await ensureDrafts(ctx, args.seasonId, format, {
        teamIds: teams.map((team) => team._id),
        schedule,
        medianGame: upcoming.medianGame,
        points,
        finalThroughWeek,
      });
    }

    return {
      teams: teams.map((team) => ({
        teamId: team._id,
        name: team.name,
        ...(team.logoUrl ? { logoUrl: team.logoUrl } : {}),
        isMine: myTeamIds.includes(team._id),
      })),
      isCommissioner,
      currentWeek,
      finalThroughWeek,
      platformRegularSeasonEndWeek: upcoming.regularSeasonEndWeek,
      medianGame: upcoming.medianGame,
      schedule,
      points,
      projected,
      platformPlayoffs,
    };
  },
});

// The season's head-to-head schedule for the rules engine: past weeks'
// pairings week by week (cached long once final), this week on from the
// live schedule.
export async function loadSeasonSchedule(
  ctx: ActionCtx,
  season: Doc<"seasons">,
  league: Doc<"leagues">,
  teams: Doc<"seasonTeams">[],
  currentWeek: number,
) {
  const upcoming = await loadLeagueSchedule(ctx, season, league, teams, currentWeek);
  const pastWeeks = Array.from(
    { length: Math.min(currentWeek - 1, upcoming.regularSeasonEndWeek) },
    (_, i) => i + 1,
  );
  const pastPairs = await Promise.all(
    pastWeeks.map((week) => loadWeekPairs(ctx, season, league, teams, week, currentWeek)),
  );
  const schedule: SeasonData["schedule"] = [
    ...pastPairs.flatMap(({ pairs }, i) =>
      pairs.map((teamIds) => ({ weeks: [pastWeeks[i]!], teamIds })),
    ),
    ...upcoming.matchups.filter((matchup) => matchup.weeks.every((week) => week >= currentWeek)),
  ];
  return { upcoming, schedule };
}

async function loadProjected(
  ctx: ActionCtx,
  season: Doc<"seasons">,
): Promise<Record<string, Record<number, number>>> {
  const inputs = await gatherPowerRankingsInputsFor(ctx, season);
  const projected: Record<string, Record<number, number>> = {};
  for (const team of inputs.teams) {
    const fpids = inputs.eligibleFpidsByTeam.get(team._id);
    if (!fpids) continue;
    const totals = computeTeamWeekTotals(fpids, inputs);
    projected[team._id] = Object.fromEntries(
      totals.map((points, i) => [inputs.currentWeek + i, points]),
    );
  }
  return projected;
}

// Opens each matchup draft once the regular season is final: its drafters
// (the drafter tier, in seed order) and pool are fixed from final standings.
async function ensureDrafts(
  ctx: ActionCtx,
  seasonId: Id<"seasons">,
  format: PlayoffFormat,
  input: Omit<Parameters<typeof evaluate>[1], "draft">,
) {
  const state = evaluate(format, { ...input, draft: EMPTY_DRAFT });
  if (!state.regularSeasonFinal) return;
  const tierOf = new Map(state.standings.map((row) => [row.teamId, row.tier]));
  for (const stage of format.stages) {
    if (stage.kind !== "groups" || stage.formation.kind !== "matchupDraft") continue;
    const entrants = state.stages[stage.id]?.entrants;
    if (!entrants) continue;
    const drafterTier = stage.formation.drafterTier;
    const isDrafter = (teamId: string) => tierOf.get(teamId) === drafterTier;
    await ctx.runMutation(internal.infiniyoffs.season.ensureDraft, {
      seasonId,
      stageId: stage.id,
      drafterIds: entrants.filter(isDrafter) as Id<"seasonTeams">[],
      poolIds: entrants.filter((teamId) => !isDrafter(teamId)) as Id<"seasonTeams">[],
    });
  }
}
