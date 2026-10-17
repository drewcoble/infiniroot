import { v } from "convex/values";
import { action, type ActionCtx } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import { Id } from "../../_generated/dataModel";
import { loadTeamRosterForWeek, type SlotLabel, type TeamRosterRow } from "./teamRoster";

export type EliminationStatus = "cut" | "bubble" | "safe";

export interface EliminationWatchRow {
  teamId: Id<"seasonTeams">;
  name: string;
  isSelf: boolean;
  // The set lineup's pregame projection for this week.
  weekPoints: number;
  rank: number;
  status: EliminationStatus;
  // The team's set starting lineup this week, with points so far once games
  // are played - the client turns these into live projections and re-ranks
  // off them (infinileague's lib/eliminationWatch.ts).
  starters: TeamRosterRow[];
}

// Starting slots only - bench/IR/taxi points don't count toward the
// week's total. Same list as infinileague's lib/matchupSummary.ts.
const STARTER_SLOTS = new Set<SlotLabel>(["QB", "SUPERFLEX", "RB", "WR", "FLEX", "TE", "DST", "K"]);

// How many of the bottom teams (by this week's projected total) count as
// "bubble" (yellow), beyond the single lowest team ("cut", red) - ~25% of
// still-active teams, minimum 2, per product decision. Applied to the
// bottom of the ranking, same direction the projected cut comes from.
function dangerZoneSize(activeTeamCount: number): number {
  return Math.max(2, Math.ceil(activeTeamCount * 0.25));
}

// This week's guillotine elimination projection: every team's set lineup
// for just the current NFL week (a guillotine league scores the lineup the
// manager actually started, not the best one they could have), ranked
// best-to-worst by its pregame projection, with the bottom slice flagged as
// cut/bubble/safe. Each team's lineup comes from the same per-week roster
// load the Matchup tab makes (loadTeamRosterForWeek), one per team.
// `week` defaults to the current NFL week; the Matchup tab passes the week
// it's viewing, since a guillotine league's "opponent" is the lowest
// projected team that week (see infinileague's useGuillotineOpponent).
export const getEliminationWatch = action({
  args: { seasonId: v.id("seasons"), week: v.optional(v.string()) },
  handler: async (ctx: ActionCtx, args): Promise<EliminationWatchRow[]> => {
    const { season, league } = await ctx.runQuery(internal.rosterSync.requireOwnedSeasonForSync, {
      seasonId: args.seasonId,
    });
    if (!season.sleeperLeagueId && !season.yahooLeagueKey && !season.espnLeagueId) {
      throw new Error("This league isn't linked to Sleeper, Yahoo, or ESPN yet.");
    }

    // Same pre-season clamp as gatherPowerRankingsInputs - week "0" isn't a
    // real week to project from.
    const nflState =
      args.week === undefined ? await ctx.runQuery(api.nflState.getNflState, {}) : null;
    const week = args.week ?? String(nflState ? Math.max(Number(nflState.week), 1) : 1);

    const teams = await ctx.runQuery(internal.seasonTeams.listSeasonTeamsInternal, {
      seasonId: args.seasonId,
    });
    const rostersByTeam = await Promise.all(
      teams.map(async (team) => ({
        team,
        rows: await loadTeamRosterForWeek(ctx, { team, season, league }, week),
      })),
    );

    // A team with zero rostered players has already been eliminated in real
    // life (a cut team's whole roster hits waivers) - there's no separate
    // "eliminated" flag anywhere in the schema, so an empty roster is the
    // signal this app has to infer that from. Excluded entirely rather than
    // shown as a permanent "cut", since this feature only ever projects
    // forward, not records history.
    const pointsByTeam = rostersByTeam
      .filter(({ rows }) => rows.some((row) => row.fpid !== undefined))
      .map(({ team, rows }) => {
        const starters = rows.filter(
          (row) => row.fpid !== undefined && row.slot !== undefined && STARTER_SLOTS.has(row.slot),
        );
        const weekPoints = starters.reduce((total, row) => total + (row.projectedPoints ?? 0), 0);
        return { team, starters, weekPoints };
      });

    // Descending - rank 1 = best/safest, same convention as
    // getPowerRankings' rankTeams, so a team's rank means the same thing on
    // every infinileague list.
    pointsByTeam.sort((a, b) => b.weekPoints - a.weekPoints);

    const zoneSize = dangerZoneSize(pointsByTeam.length);
    return pointsByTeam.map(({ team, starters, weekPoints }, index) => {
      const rankFromBottom = pointsByTeam.length - index;
      const status: EliminationStatus =
        rankFromBottom === 1
          ? "cut"
          : rankFromBottom <= zoneSize
            ? "bubble"
            : "safe";
      return {
        teamId: team._id,
        name: team.name,
        isSelf: team.isSelf,
        weekPoints,
        rank: index + 1,
        status,
        starters,
      };
    });
  },
});
