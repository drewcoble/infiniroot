import { v } from "convex/values";
import { action, ActionCtx, internalMutation, internalQuery } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import { Doc, Id } from "../../_generated/dataModel";
import { fetchSleeperJson, sleeperPlayerIdToFpid, type SleeperRoster } from "../../sleeper/league";
import {
  optimizeLineup,
  type LineupPick,
  type StarterCategory,
} from "../../infinidraft/draft/lineupOptimizer";
import { POSITIONS } from "../../positions";

type Position = (typeof POSITIONS)[number];

export interface TeamPositionRanks {
  teamId: Id<"seasonTeams">;
  // Percentile (0-100) of this team's overall rest-of-season optimal-lineup
  // total among the league - the same underlying number getPowerRankings'
  // totalProjectedPoints ranks by, just percentile-normalized instead of
  // left as a raw point total, mirroring convex/infinidraft/draft/
  // reportCard.ts's gradeScore (see percentileRank below) but with a single
  // input rather than a 3-way surplus/VOR/lineup-efficiency blend, since
  // infinileague has no draft-day surplus/VOR concept to blend in - this
  // literally IS the power ranking, just rescaled to 0-100.
  gradeScore: number;
  // One entry per roster-slot category the league actually starts (see
  // CATEGORY_ORDER/activeCategories below) - each team's 1-indexed rank
  // within that category's summed optimal-lineup points, league-wide.
  // Mirrors reportCard.ts's identical positionalRanks field/radar chart.
  positionalRanks: { category: StarterCategory; rank: number }[];
}

// Display/rank order for the position radar chart - QB folds in SUPERFLEX,
// FLEX sits with the skill positions it pools from rather than at the end.
// Same order convex/infinidraft/draft/reportCard.ts's CATEGORY_ORDER uses.
const CATEGORY_ORDER: StarterCategory[] = ["QB", "RB", "WR", "TE", "FLEX", "DST", "K"];

// Standard percentile rank: share of the field strictly below `value`, plus
// half credit for ties (including the value's own row) - range (0, 100].
// Ported verbatim from reportCard.ts's identical helper (see its own
// comment) so infinileague's gradeScore reads on the same scale as
// infinidraft's, even though the inputs behind it differ.
function percentileRank(value: number, all: number[]): number {
  if (all.length <= 1) return 50;
  let below = 0;
  let equal = 0;
  for (const v of all) {
    if (v < value) below++;
    else if (v === value) equal++;
  }
  return ((below + equal / 2) / all.length) * 100;
}

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

interface PowerRankingsInputs {
  season: Doc<"seasons">;
  currentWeek: number;
  teams: Doc<"seasonTeams">[];
  // Every rostered player except taxi/IR - same eligible-pool rule as
  // src/lib/lineupSuggestions.ts's buildLineupSuggestions, a legitimate
  // optimal-lineup candidate regardless of who's actually starting today.
  eligibleFpidsByTeam: Map<Id<"seasonTeams">, number[]>;
  positionByFpid: Map<number, Position>;
  // One map per remaining week (current week through 18), each already
  // covering every position in one shot - shared across every team's
  // computeTeamTotal call rather than refetched per team.
  projectionMapsByWeek: Map<number, Doc<"projections">>[];
}

// Shared setup both getPowerRankings and getPowerRankingsWithTrade need:
// live Sleeper rosters (for each team's real current player pool) plus
// every remaining week's projections (for computeTeamTotal below). Fetched
// once per action call regardless of how many teams' totals end up
// computed from it - a trade only ever touches two teams, so the
// hypothetical run reuses this same gathered data rather than refetching.
async function gatherPowerRankingsInputs(
  ctx: ActionCtx,
  seasonId: Id<"seasons">,
): Promise<PowerRankingsInputs> {
  const { season } = await ctx.runQuery(internal.rosterSync.requireOwnedSeasonForSync, {
    seasonId,
  });
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
    ctx.runQuery(internal.seasonTeams.listSeasonTeamsInternal, { seasonId }),
    fetchSleeperJson<SleeperRoster[]>(`/league/${season.sleeperLeagueId}/rosters`),
  ]);
  const rosterBySleeperRosterId = new Map(
    rosters.map((roster) => [String(roster.roster_id), roster]),
  );

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
  // team - each call already returns every position's projections for that
  // week in one shot, so this is O(weeks) rather than O(teams * weeks).
  const projectionsByWeek = await Promise.all(
    weeks.map((week) => ctx.runQuery(api.projections.getAllProjections, { week })),
  );
  const projectionMapsByWeek = projectionsByWeek.map(
    (rows) => new Map(rows.map((row) => [row.fpid, row])),
  );

  return { season, currentWeek, teams, eligibleFpidsByTeam, positionByFpid, projectionMapsByWeek };
}

// One week's LineupPick list for a given fpid list - shared by
// computeTeamTotal and computeTeamCategoryTotals below, which otherwise
// only differ in which part of optimizeLineup's result they keep.
function buildWeekPicks(
  fpids: number[],
  projectionByFpid: Map<number, Doc<"projections">>,
  { season, positionByFpid }: PowerRankingsInputs,
): LineupPick[] {
  const picks: LineupPick[] = [];
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
    picks.push({ fpid, position, points, sequence: i });
  });
  return picks;
}

// One team's optimal-lineup total, summed across every week in
// projectionMapsByWeek - the same per-week optimizeLineup call
// getPowerRankings always ran, just factored out so a hypothetical
// (post-trade) fpid list can be scored the exact same way as every real
// team's current roster.
function computeTeamTotal(fpids: number[], inputs: PowerRankingsInputs): number {
  let total = 0;
  for (const projectionByFpid of inputs.projectionMapsByWeek) {
    const picks = buildWeekPicks(fpids, projectionByFpid, inputs);
    total += optimizeLineup(
      picks,
      inputs.season.rosterSlots,
      inputs.season.flexPositions,
      inputs.season.superflexPositions,
    ).optimalPoints;
  }
  return total;
}

// Same total as computeTeamTotal, broken down by StarterCategory instead of
// collapsed to one scalar - optimizeLineup already computes this breakdown
// every call (see LineupResult.optimalPointsByCategory), getPowerRankings
// just never kept it; this is that same per-week loop, summing each
// category across the rest of the season instead of discarding them.
function computeTeamCategoryTotals(
  fpids: number[],
  inputs: PowerRankingsInputs,
): Record<StarterCategory, number> {
  const totals = Object.fromEntries(
    [...POSITIONS, "FLEX"].map((category) => [category, 0]),
  ) as Record<StarterCategory, number>;
  for (const projectionByFpid of inputs.projectionMapsByWeek) {
    const picks = buildWeekPicks(fpids, projectionByFpid, inputs);
    const result = optimizeLineup(
      picks,
      inputs.season.rosterSlots,
      inputs.season.flexPositions,
      inputs.season.superflexPositions,
    );
    for (const category of Object.keys(totals) as StarterCategory[]) {
      totals[category] += result.optimalPointsByCategory[category];
    }
  }
  return totals;
}

// Ranks every team with a known total, descending - shared by
// getPowerRankings' real-roster totals and getPowerRankingsWithTrade's
// before/after totals alike.
function rankTeams(
  teams: Doc<"seasonTeams">[],
  totalByTeam: Map<Id<"seasonTeams">, number>,
): { team: Doc<"seasonTeams">; totalProjectedPoints: number }[] {
  return teams
    .filter((team) => totalByTeam.has(team._id))
    .map((team) => ({ team, totalProjectedPoints: totalByTeam.get(team._id) ?? 0 }))
    .sort((a, b) => b.totalProjectedPoints - a.totalProjectedPoints);
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
    const inputs = await gatherPowerRankingsInputs(ctx, args.seasonId);
    const { teams, eligibleFpidsByTeam } = inputs;

    const totalByTeam = new Map<Id<"seasonTeams">, number>();
    for (const team of teams) {
      const fpids = eligibleFpidsByTeam.get(team._id);
      if (!fpids) continue;
      totalByTeam.set(team._id, computeTeamTotal(fpids, inputs));
    }

    const ranked = rankTeams(teams, totalByTeam);

    const currentWeekStr = String(inputs.currentWeek);
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

// Same rest-of-season power rankings as getPowerRankings, computed twice:
// once for every team's real current roster ("before"), once with
// outgoingFromA/outgoingFromB swapped between teamAId/teamBId ("after") -
// every other team's total is untouched by a two-team trade, but their RANK
// can still move if teamA or teamB crosses past them, so both full lists
// are returned rather than just the two traded teams' numbers. Doesn't save
// a snapshot (see saveSnapshot) - this is a hypothetical, not a real
// week's result, so it must never feed rankChange's week-over-week history.
export const getPowerRankingsWithTrade = action({
  args: {
    seasonId: v.id("seasons"),
    teamAId: v.id("seasonTeams"),
    teamBId: v.id("seasonTeams"),
    outgoingFromA: v.array(v.number()),
    outgoingFromB: v.array(v.number()),
  },
  handler: async (ctx: ActionCtx, args): Promise<{ before: PowerRankingRow[]; after: PowerRankingRow[] }> => {
    const inputs = await gatherPowerRankingsInputs(ctx, args.seasonId);
    const { teams, eligibleFpidsByTeam } = inputs;

    const totalByTeam = new Map<Id<"seasonTeams">, number>();
    for (const team of teams) {
      const fpids = eligibleFpidsByTeam.get(team._id);
      if (!fpids) continue;
      totalByTeam.set(team._id, computeTeamTotal(fpids, inputs));
    }

    const outgoingASet = new Set(args.outgoingFromA);
    const outgoingBSet = new Set(args.outgoingFromB);
    const aFpids = eligibleFpidsByTeam.get(args.teamAId) ?? [];
    const bFpids = eligibleFpidsByTeam.get(args.teamBId) ?? [];
    const newAFpids = [...aFpids.filter((fpid) => !outgoingASet.has(fpid)), ...args.outgoingFromB];
    const newBFpids = [...bFpids.filter((fpid) => !outgoingBSet.has(fpid)), ...args.outgoingFromA];

    const hypotheticalTotalByTeam = new Map(totalByTeam);
    hypotheticalTotalByTeam.set(args.teamAId, computeTeamTotal(newAFpids, inputs));
    hypotheticalTotalByTeam.set(args.teamBId, computeTeamTotal(newBFpids, inputs));

    const toRows = (ranked: { team: Doc<"seasonTeams">; totalProjectedPoints: number }[]): PowerRankingRow[] =>
      ranked.map(({ team, totalProjectedPoints }) => ({
        teamId: team._id,
        name: team.name,
        isSelf: team.isSelf,
        totalProjectedPoints,
      }));

    return {
      before: toRows(rankTeams(teams, totalByTeam)),
      after: toRows(rankTeams(teams, hypotheticalTotalByTeam)),
    };
  },
});

// Per-team positional strength for the dashboard's expandable team cards'
// radar chart (see infinileague/src/components/PositionRadarChart.tsx) -
// same computation and shape as convex/infinidraft/draft/reportCard.ts's
// positionalRanks/gradeScore, just built from this season's real current
// rosters (via gatherPowerRankingsInputs) instead of draft picks, since
// infinileague has no draft to grade.
export const getTeamPositionRanks = action({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx: ActionCtx, args): Promise<TeamPositionRanks[]> => {
    const inputs = await gatherPowerRankingsInputs(ctx, args.seasonId);
    const { season, teams, eligibleFpidsByTeam } = inputs;

    // Categories the league's roster shape actually uses - a league with no
    // K/DST or no FLEX shouldn't show a flatlined rank-1-for-everyone wedge
    // on the radar chart for a slot nobody starts. Same filter reportCard.ts
    // uses.
    const activeCategories = CATEGORY_ORDER.filter((category) => {
      if (category === "FLEX") return season.rosterSlots.FLEX > 0;
      if (category === "QB") {
        return season.rosterSlots.QB > 0 || season.rosterSlots.SUPERFLEX > 0;
      }
      return season.rosterSlots[category] > 0;
    });

    const categoryTotalsByTeam = new Map<Id<"seasonTeams">, Record<StarterCategory, number>>();
    for (const team of teams) {
      const fpids = eligibleFpidsByTeam.get(team._id);
      if (!fpids) continue;
      categoryTotalsByTeam.set(team._id, computeTeamCategoryTotals(fpids, inputs));
    }

    const categoryRankByTeam = new Map<StarterCategory, Map<Id<"seasonTeams">, number>>();
    for (const category of activeCategories) {
      const ranked = [...categoryTotalsByTeam.entries()].sort(
        (a, b) => b[1][category] - a[1][category],
      );
      categoryRankByTeam.set(
        category,
        new Map(ranked.map(([teamId], index) => [teamId, index + 1])),
      );
    }

    // Overall total is just every category's total added back together -
    // the same optimalPoints figure getPowerRankings ranks by, decomposed
    // rather than recomputed (optimizeLineup's optimalPointsByCategory
    // values already sum to its own optimalPoints).
    const overallTotalByTeam = new Map(
      [...categoryTotalsByTeam.entries()].map(([teamId, totals]) => [
        teamId,
        Object.values(totals).reduce((sum, value) => sum + value, 0),
      ]),
    );
    const allTotals = [...overallTotalByTeam.values()];

    return teams
      .filter((team) => categoryTotalsByTeam.has(team._id))
      .map((team) => {
        const total = overallTotalByTeam.get(team._id) ?? 0;
        return {
          teamId: team._id,
          gradeScore: Math.round(percentileRank(total, allTotals)),
          positionalRanks: activeCategories.map((category) => ({
            category,
            rank: categoryRankByTeam.get(category)?.get(team._id) ?? 1,
          })),
        };
      });
  },
});
