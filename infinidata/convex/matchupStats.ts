import { v } from "convex/values";
import {
  internalMutation,
  internalAction,
  action,
  query,
  QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { positionValidator, POSITIONS } from "./positions";
import { requireSuperAdmin, currentSeason } from "./lib/dataFetch";
import { normalizeTank01Team } from "./tank01/client";

const WEEKS = Array.from({ length: 18 }, (_, i) => String(i + 1));

// Adds (not averages) raw per-category stat blobs together - the opposite of
// projectionBlending.ts's mergeStats, which averages across providers for
// the SAME player. Here every blob belongs to a different player at the
// same position, so a team's total exposure at that position is a sum.
function sumStats(
  statsList: Array<Record<string, number> | undefined>,
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const stats of statsList) {
    for (const [key, value] of Object.entries(stats ?? {})) {
      totals[key] = (totals[key] ?? 0) + value;
    }
  }
  return totals;
}

// team -> opponent for one (season, week), derived from nflGames the same
// way convex/infinileague/auction/eligibility.ts and convex/sleeper/
// transactions.ts already join nflGames.homeTeam/awayTeam against a team.
// nflGames stores Tank01's own team abbreviations verbatim (e.g. "WSH"), so
// every consumer normalizes to this app's Sleeper-derived convention (e.g.
// "WAS", matching players.team/projections.team) at the join site rather
// than nflGames being fixed up at write time - see normalizeTank01Team's own
// comment. Teams absent from every game that week (bye, or the schedule
// hasn't been synced that far out yet) are simply missing from the map.
async function buildOpponentMap(
  ctx: QueryCtx,
  args: { season: string; week: string },
): Promise<Map<string, string>> {
  const games = await ctx.db
    .query("nflGames")
    .withIndex("by_season_week", (q) =>
      q.eq("season", args.season).eq("week", args.week),
    )
    .collect();

  const opponents = new Map<string, string>();
  for (const game of games) {
    const homeTeam = normalizeTank01Team(game.homeTeam);
    const awayTeam = normalizeTank01Team(game.awayTeam);
    opponents.set(homeTeam, awayTeam);
    opponents.set(awayTeam, homeTeam);
  }
  return opponents;
}

// Core compute for one (season, week, position): sums the opposing team's
// projected and actual production at this position for every team playing
// that week, and replaces this position's existing rows for the week.
// Scoped to a single position (not all of POSITIONS in one call) so one
// transaction's read count stays bounded - see convex/sleeper/
// playerPoints.ts's own CHUNK_SIZE comment for the read-limit this is
// avoiding. Worst case (a high-volume position like WR): a few hundred
// projections rows + up to ~3x as many playerPoints rows (one per scoring
// format) + 16 nflGames rows + a handful of fallback player lookups + ~64
// writes - comfortably under Convex's per-transaction read cap, and far
// smaller than doing every position (and playerPoints' 3x multiplier) in a
// single transaction.
export const refreshTeamMatchupStatsForPosition = internalMutation({
  args: {
    season: v.string(),
    week: v.string(),
    position: positionValidator,
  },
  handler: async (ctx, args) => {
    const opponents = await buildOpponentMap(ctx, args);

    // Projected side: projections already stores each row's own `team`, so
    // no join is needed here (unlike playerPoints below).
    const projectionRows = await ctx.db
      .query("projections")
      .withIndex("by_position_week", (q) =>
        q.eq("position", args.position).eq("week", args.week),
      )
      .collect();

    type ProjectedBucket = {
      pointsStd: number;
      pointsHalf: number;
      pointsPpr: number;
      stats: Array<Record<string, number>>;
      count: number;
    };
    const projectedByTeam = new Map<string, ProjectedBucket>();
    const fpidToTeam = new Map<number, string>();

    for (const row of projectionRows) {
      if (row.season !== args.season || !row.team) continue;
      fpidToTeam.set(row.fpid, row.team);
      const bucket = projectedByTeam.get(row.team) ?? {
        pointsStd: 0,
        pointsHalf: 0,
        pointsPpr: 0,
        stats: [],
        count: 0,
      };
      bucket.pointsStd += row.pointsStd;
      bucket.pointsHalf += row.pointsHalf;
      bucket.pointsPpr += row.pointsPpr;
      bucket.stats.push(row.stats);
      bucket.count += 1;
      projectedByTeam.set(row.team, bucket);
    }

    // Actual side: playerPoints has no `team` field, so each row's team is
    // resolved via this week's projections (fpidToTeam above) first, falling
    // back to a players.by_fpid lookup for any fpid that projections didn't
    // cover that week (e.g. a very late addition) - same per-fpid player
    // lookup convex/projectionBlending.ts's blendProjections already does.
    const playerPointsRows = await ctx.db
      .query("playerPoints")
      .withIndex("by_position_week_season", (q) =>
        q
          .eq("position", args.position)
          .eq("week", args.week)
          .eq("season", args.season),
      )
      .collect();

    type ActualBucket = {
      pointsStd: number;
      pointsHalf: number;
      pointsPpr: number;
      stats: Array<Record<string, number>>;
      seenFpids: Set<number>;
    };
    const actualByTeam = new Map<string, ActualBucket>();

    for (const row of playerPointsRows) {
      let team = fpidToTeam.get(row.fpid);
      if (!team) {
        const player = await ctx.db
          .query("players")
          .withIndex("by_fpid", (q) => q.eq("fpid", row.fpid))
          .first();
        if (!player?.team) continue;
        team = player.team;
        fpidToTeam.set(row.fpid, team);
      }

      const bucket = actualByTeam.get(team) ?? {
        pointsStd: 0,
        pointsHalf: 0,
        pointsPpr: 0,
        stats: [],
        seenFpids: new Set<number>(),
      };
      if (row.scoring === "STD") bucket.pointsStd += row.points;
      if (row.scoring === "HALF") bucket.pointsHalf += row.points;
      if (row.scoring === "PPR") bucket.pointsPpr += row.points;
      // Raw stats don't vary by scoring format - only count each fpid's box
      // score once (via the STD row) even though it appears in all 3.
      if (row.scoring === "STD") {
        bucket.stats.push(row.stats ?? {});
        bucket.seenFpids.add(row.fpid);
      }
      actualByTeam.set(team, bucket);
    }

    const existingForPosition = await ctx.db
      .query("teamMatchupStats")
      .withIndex("by_position_season_week", (q) =>
        q
          .eq("position", args.position)
          .eq("season", args.season)
          .eq("week", args.week),
      )
      .collect();
    for (const row of existingForPosition) {
      await ctx.db.delete(row._id);
    }

    const now = Date.now();
    let upserted = 0;
    for (const [team, opponent] of opponents) {
      const projected = projectedByTeam.get(opponent);
      const actual = actualByTeam.get(opponent);

      await ctx.db.insert("teamMatchupStats", {
        team,
        opponent,
        season: args.season,
        week: args.week,
        position: args.position,
        projectedPointsStd: projected?.pointsStd ?? 0,
        projectedPointsHalf: projected?.pointsHalf ?? 0,
        projectedPointsPpr: projected?.pointsPpr ?? 0,
        projectedStats: sumStats(projected?.stats ?? []),
        projectedPlayerCount: projected?.count ?? 0,
        actualPointsStd: actual?.pointsStd ?? 0,
        actualPointsHalf: actual?.pointsHalf ?? 0,
        actualPointsPpr: actual?.pointsPpr ?? 0,
        actualStats: sumStats(actual?.stats ?? []),
        actualPlayerCount: actual?.seenFpids.size ?? 0,
        updatedAt: now,
      });
      upserted += 1;
    }

    return { upserted };
  },
});

// One week's worth of refreshTeamMatchupStatsForPosition, one position at a
// time - the unit of work both the daily cron (fetchAllData.ts) and the
// manual backfill action below schedule/call per week.
export const refreshTeamMatchupStatsForWeek = internalAction({
  args: { season: v.string(), week: v.string() },
  handler: async (ctx, args) => {
    for (const position of POSITIONS) {
      await ctx.runMutation(
        internal.matchupStats.refreshTeamMatchupStatsForPosition,
        { season: args.season, week: args.week, position },
      );
    }
  },
});

// Admin-triggered full-season (re)compute - mirrors convex/fetchAllData.ts's
// refreshCaches. Recomputes every week 1-18 from whatever projections/
// playerPoints/nflGames data already exists, so running this once backfills
// already-played weeks the same way it fills in future, projected-only ones.
export const refreshAllTeamMatchupStats = action({
  args: { season: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);
    const season = args.season ?? currentSeason();

    for (const week of WEEKS) {
      await ctx.runAction(
        internal.matchupStats.refreshTeamMatchupStatsForWeek,
        { season, week },
      );
    }
  },
});

// League-wide view for one week - "toughest/easiest matchups this week".
export const getTeamMatchupStatsForWeek = query({
  args: { season: v.string(), week: v.string() },
  handler: async (ctx, args) => {
    const results = [];
    for (const position of POSITIONS) {
      const rows = await ctx.db
        .query("teamMatchupStats")
        .withIndex("by_position_season_week", (q) =>
          q
            .eq("position", position)
            .eq("season", args.season)
            .eq("week", args.week),
        )
        .collect();
      results.push(...rows);
    }
    return results;
  },
});

// One team's matchup trend across a season, every position - powers the
// "IND's DST impact on players" / "expect a good or bad matchup" use case.
export const getTeamMatchupHistory = query({
  args: { team: v.string(), season: v.string() },
  handler: async (ctx, args) => {
    const results = [];
    for (const position of POSITIONS) {
      const rows = await ctx.db
        .query("teamMatchupStats")
        .withIndex("by_team_position_season", (q) =>
          q
            .eq("team", args.team)
            .eq("position", position)
            .eq("season", args.season),
        )
        .collect();
      results.push(...rows);
    }
    return results.sort((a, b) => Number(a.week) - Number(b.week));
  },
});
