import { v } from "convex/values";
import { action, ActionCtx } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import { Id } from "../../_generated/dataModel";
import { fetchSleeperJson, sleeperPlayerIdToFpid, type SleeperRoster } from "../../sleeper/league";
import { optimizeLineup, type LineupPick } from "../../infinidraft/draft/lineupOptimizer";

export interface PowerRankingRow {
  teamId: Id<"seasonTeams">;
  name: string;
  isSelf: boolean;
  totalProjectedPoints: number;
}

// Each team's optimal-lineup total, projected from the current NFL week
// through week 18, ranked descending - a rest-of-season strength read
// (roster construction + matchup schedule via bye weeks already baked into
// the week-by-week projections), as opposed to standings.ts's backward-
// looking win/loss record. Reuses infinidraft's own lineup optimizer (see
// convex/infinidraft/draft/lineupOptimizer.ts) rather than infinileague's
// client-side lib/lineupSuggestions.ts, since only the "what's the best
// possible total" half matters here, not the actual-vs-optimal diff, and
// this needs to run server-side across every team/week in one pass.
export const getPowerRankings = action({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx: ActionCtx, args): Promise<PowerRankingRow[]> => {
    const { season } = await ctx.runQuery(
      internal.rosterSync.requireOwnedSeasonForSync,
      { seasonId: args.seasonId },
    );
    if (!season.sleeperLeagueId) {
      throw new Error("This league isn't linked to a Sleeper league yet.");
    }

    const nflState = await ctx.runQuery(api.nflState.getNflState, {});
    // Clamped the same way the team page's own week picker defaults (see
    // routes/league/$leagueId/teams/$teamId.tsx) - pre-season (week "0")
    // isn't a real week to project from, so start at week 1.
    const currentWeek = nflState ? Math.max(Number(nflState.week), 1) : 1;
    const weeks = Array.from({ length: 18 - currentWeek + 1 }, (_, i) =>
      String(currentWeek + i),
    );

    const [teams, rosters] = await Promise.all([
      ctx.runQuery(internal.seasonTeams.listSeasonTeamsInternal, {
        seasonId: args.seasonId,
      }),
      fetchSleeperJson<SleeperRoster[]>(`/league/${season.sleeperLeagueId}/rosters`),
    ]);
    const rosterBySleeperRosterId = new Map(
      rosters.map((roster) => [String(roster.roster_id), roster]),
    );

    // Same eligible-pool rule as src/lib/lineupSuggestions.ts's
    // buildLineupSuggestions: every rostered player except taxi/IR is a
    // legitimate optimal-lineup candidate, regardless of who's actually
    // starting today.
    const eligibleFpidsByTeam = new Map<Id<"seasonTeams">, number[]>();
    const allFpids = new Set<number>();
    for (const team of teams) {
      if (!team.sleeperRosterId) continue;
      const roster = rosterBySleeperRosterId.get(team.sleeperRosterId);
      if (!roster) continue;
      const taxiIds = new Set(roster.taxi ?? []);
      const reserveIds = new Set(roster.reserve ?? []);
      const fpids = (roster.players ?? [])
        .filter((playerId) => !taxiIds.has(playerId) && !reserveIds.has(playerId))
        .map(sleeperPlayerIdToFpid)
        .filter((fpid): fpid is number => fpid !== null);
      eligibleFpidsByTeam.set(team._id, fpids);
      for (const fpid of fpids) allFpids.add(fpid);
    }

    const players = await ctx.runQuery(api.players.getPlayersByFpids, {
      fpids: [...allFpids],
    });
    const positionByFpid = new Map(players.map((player) => [player.fpid, player.position]));

    // One getAllProjections call per remaining week, shared across every
    // team - each call already returns every position's projections for
    // that week in one shot, so this is O(weeks) rather than O(teams * weeks).
    const projectionsByWeek = await Promise.all(
      weeks.map((week) => ctx.runQuery(api.projections.getAllProjections, { week })),
    );
    const projectionMapsByWeek = projectionsByWeek.map(
      (rows) => new Map(rows.map((row) => [row.fpid, row])),
    );

    const totalByTeam = new Map<Id<"seasonTeams">, number>();
    for (const team of teams) {
      const fpids = eligibleFpidsByTeam.get(team._id);
      if (!fpids) continue;

      let total = 0;
      for (const projectionByFpid of projectionMapsByWeek) {
        const teamPicks: LineupPick[] = [];
        fpids.forEach((fpid, i) => {
          const position = positionByFpid.get(fpid);
          if (!position) return;
          const projection = projectionByFpid.get(fpid);
          const points = projection
            ? season.scoring === "PPR"
              ? projection.pointsPpr
              : season.scoring === "HALF"
                ? projection.pointsHalf
                : projection.pointsStd
            : 0;
          teamPicks.push({ fpid, position, points, sequence: i });
        });

        total += optimizeLineup(
          teamPicks,
          season.rosterSlots,
          season.flexPositions,
          season.superflexPositions,
        ).optimalPoints;
      }
      totalByTeam.set(team._id, total);
    }

    return teams
      .filter((team) => totalByTeam.has(team._id))
      .map((team) => ({
        teamId: team._id,
        name: team.name,
        isSelf: team.isSelf,
        totalProjectedPoints: totalByTeam.get(team._id) ?? 0,
      }))
      .sort((a, b) => b.totalProjectedPoints - a.totalProjectedPoints);
  },
});
