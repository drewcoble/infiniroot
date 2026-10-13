import { v } from "convex/values";
import { action, type ActionCtx } from "../../_generated/server";
import { api } from "../../_generated/api";
import { Id } from "../../_generated/dataModel";
import {
  gatherPowerRankingsInputs,
  buildWeekPicks,
} from "./powerRankings";
import { optimizeLineup } from "../../infinidraft/draft/lineupOptimizer";
import { loadTeamRosterForWeek, type SlotLabel, type TeamRosterRow } from "./teamRoster";

export type EliminationStatus = "cut" | "bubble" | "safe";

export interface EliminationWatchRow {
  teamId: Id<"seasonTeams">;
  name: string;
  isSelf: boolean;
  weekPoints: number;
  rank: number;
  status: EliminationStatus;
  // The team's actual starting lineup this week, with points so far - only
  // present once the week's first game has kicked off, when set lineups
  // (not the optimal one) are what's actually being scored. The client
  // turns these into live projections and re-ranks off them.
  starters?: TeamRosterRow[];
}

// Starting slots only - bench/IR/taxi points don't count toward the
// week's total. Same list as infinileague's lib/matchupSummary.ts.
const STARTER_SLOTS = new Set<SlotLabel>(["QB", "SUPERFLEX", "RB", "WR", "FLEX", "TE", "DST", "K"]);

// How many of the bottom teams (by this week's optimal-lineup total) count
// as "bubble" (yellow), beyond the single lowest team ("cut", red) - ~25% of
// still-active teams, minimum 2, per product decision. Applied to the
// bottom of the ranking, same direction the projected cut comes from.
function dangerZoneSize(activeTeamCount: number): number {
  return Math.max(2, Math.ceil(activeTeamCount * 0.25));
}

// This week's guillotine elimination projection: every team's optimal-
// lineup total for just the current NFL week (not rest-of-season, unlike
// getPowerRankings), ranked best-to-worst, with the bottom slice flagged as
// cut/bubble/safe. Reuses gatherPowerRankingsInputs/buildWeekPicks from
// powerRankings.ts (same live-roster + projections gathering, just capped
// to 1 week via weeksAhead) rather than re-fetching Sleeper/Yahoo rosters
// from scratch. Once the week kicks off, each row also carries the team's
// set starters with points so far, which the client re-ranks into live
// projections (infinileague's lib/eliminationWatch.ts).
export const getEliminationWatch = action({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx: ActionCtx, args): Promise<EliminationWatchRow[]> => {
    const inputs = await gatherPowerRankingsInputs(ctx, args.seasonId, 1);
    const { teams, eligibleFpidsByTeam, projectionMapsByWeek } = inputs;
    // weeksAhead: 1 above guarantees exactly one entry - the fallback is
    // just to satisfy noUncheckedIndexedAccess, never actually hit.
    const currentWeekProjections = projectionMapsByWeek[0] ?? new Map();

    // A team with zero rostered players has already been eliminated in real
    // life (a cut team's whole roster hits waivers) - there's no separate
    // "eliminated" flag anywhere in the schema, so an empty roster is the
    // signal this app has to infer that from. Excluded entirely rather than
    // shown as a permanent "cut", since this feature only ever projects
    // forward, not records history.
    const activeTeams = teams.filter(
      (team) => (eligibleFpidsByTeam.get(team._id) ?? []).length > 0,
    );

    const pointsByTeam = activeTeams.map((team) => {
      const fpids = eligibleFpidsByTeam.get(team._id) ?? [];
      const picks = buildWeekPicks(fpids, currentWeekProjections, inputs);
      const weekPoints = optimizeLineup(
        picks,
        inputs.season.rosterSlots,
        inputs.season.flexPositions,
        inputs.season.superflexPositions,
      ).optimalPoints;
      return { team, weekPoints };
    });

    // Descending - rank 1 = best/safest, same convention as
    // getPowerRankings' rankTeams, so a team's rank means the same thing on
    // every infinileague list.
    pointsByTeam.sort((a, b) => b.weekPoints - a.weekPoints);

    // Once the week is underway, every team's real lineup and points so far
    // - one roster load per team, the same one the Matchup tab makes.
    const startersByTeam = (await hasWeekKickedOff(ctx, String(inputs.currentWeek)))
      ? new Map(
          await Promise.all(
            activeTeams.map(async (team) => {
              const rows = await loadTeamRosterForWeek(
                ctx,
                { team, season: inputs.season, league: inputs.league },
                String(inputs.currentWeek),
              );
              const starters = rows.filter(
                (row) => row.slot !== undefined && STARTER_SLOTS.has(row.slot),
              );
              return [team._id, starters] as const;
            }),
          ),
        )
      : undefined;

    const zoneSize = dangerZoneSize(pointsByTeam.length);
    return pointsByTeam.map(({ team, weekPoints }, index) => {
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
        ...(startersByTeam ? { starters: startersByTeam.get(team._id) ?? [] } : {}),
      };
    });
  },
});

// Whether any of this week's games has kicked off yet - an action can read
// the clock, unlike getWeekGames itself.
async function hasWeekKickedOff(ctx: ActionCtx, week: string): Promise<boolean> {
  const nflState = await ctx.runQuery(api.nflState.getNflState, {});
  if (!nflState) return false;
  const games = await ctx.runQuery(api.sleeper.livePoints.getWeekGames, {
    season: nflState.season,
    week,
  });
  const now = Date.now();
  return games.some((game) => game.kickoffAt <= now);
}
