import { v } from "convex/values";
import { action, ActionCtx, internalMutation, internalQuery } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import { Doc, Id } from "../../_generated/dataModel";
import { fetchSleeperJson, sleeperPlayerIdToFpid, type SleeperRoster } from "../../sleeper/league";
import { optimizeLineup, type LineupPick } from "../../infinidraft/draft/lineupOptimizer";

export interface PowerRankingRow {
  teamId: Id<"seasonTeams">;
  name: string;
  isSelf: boolean;
  totalProjectedPoints: number;
  // Rank this week minus rank last snapshotted week (positive = moved up,
  // negative = moved down) - undefined when there's no prior snapshot to
  // compare against yet (first time power rankings have run for this
  // season, or every earlier week got skipped).
  rankChange?: number;
}

// Latest snapshot strictly before `beforeWeek` - not necessarily
// beforeWeek - 1, since a season can go a week or more without the
// dashboard (and so getPowerRankings) ever being opened.
export const getLatestSnapshotBeforeWeek = internalQuery({
  args: { seasonId: v.id("seasons"), beforeWeek: v.string() },
  handler: async (ctx, args): Promise<Doc<"powerRankingSnapshots"> | null> => {
    const rows = await ctx.db
      .query("powerRankingSnapshots")
      .withIndex("by_season_week", (q) => q.eq("seasonId", args.seasonId))
      .collect();
    const before = rows.filter((row) => Number(row.week) < Number(args.beforeWeek));
    if (before.length === 0) return null;
    return before.reduce((latest, row) =>
      Number(row.week) > Number(latest.week) ? row : latest,
    );
  },
});

// Upserted every time getPowerRankings runs for a given week - same-week
// reruns (a trade/waiver changes the roster, or the page just gets
// reloaded) refresh that week's row in place rather than piling up
// duplicates, so "last week's snapshot" always means the last thing this
// action actually computed for that week, not its first-ever run.
export const saveSnapshot = internalMutation({
  args: {
    seasonId: v.id("seasons"),
    week: v.string(),
    teamIds: v.array(v.id("seasonTeams")),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("powerRankingSnapshots")
      .withIndex("by_season_week", (q) =>
        q.eq("seasonId", args.seasonId).eq("week", args.week),
      )
      .first();
    const computedAt = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { teamIds: args.teamIds, computedAt });
    } else {
      await ctx.db.insert("powerRankingSnapshots", {
        seasonId: args.seasonId,
        week: args.week,
        teamIds: args.teamIds,
        computedAt,
      });
    }
  },
});

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

    const ranked = teams
      .filter((team) => totalByTeam.has(team._id))
      .map((team) => ({ team, totalProjectedPoints: totalByTeam.get(team._id) ?? 0 }))
      .sort((a, b) => b.totalProjectedPoints - a.totalProjectedPoints);

    const currentWeekStr = String(currentWeek);
    const previousSnapshot = await ctx.runQuery(
      internal.infinileague.season.powerRankings.getLatestSnapshotBeforeWeek,
      { seasonId: args.seasonId, beforeWeek: currentWeekStr },
    );
    const previousRankByTeam = new Map<Id<"seasonTeams">, number>();
    previousSnapshot?.teamIds.forEach((teamId, i) => previousRankByTeam.set(teamId, i + 1));

    await ctx.runMutation(internal.infinileague.season.powerRankings.saveSnapshot, {
      seasonId: args.seasonId,
      week: currentWeekStr,
      teamIds: ranked.map(({ team }) => team._id),
    });

    return ranked.map(({ team, totalProjectedPoints }, index) => {
      const previousRank = previousRankByTeam.get(team._id);
      return {
        teamId: team._id,
        name: team.name,
        isSelf: team.isSelf,
        totalProjectedPoints,
        ...(previousRank !== undefined ? { rankChange: previousRank - (index + 1) } : {}),
      };
    });
  },
});
