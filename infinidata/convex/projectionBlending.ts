import { v } from "convex/values";
import { action, internalMutation } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { BLENDED_POSITIONS, positionValidator } from "./positions";
import { computeProjectedPoints } from "./scoring";
import { requireSuperAdmin, currentSeason } from "./fantasyPros/client";

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// Merges raw per-category stats across providers for one player: a category
// every provider that has data for this player reports is averaged; a
// category only one of them reports is taken as-is (never zeroed out just
// because a differently-shaped provider didn't report it).
function mergeStats(
  statsList: Record<string, number>[],
): Record<string, number> {
  const sums = new Map<string, { total: number; count: number }>();
  for (const stats of statsList) {
    for (const [key, value] of Object.entries(stats)) {
      const entry = sums.get(key) ?? { total: 0, count: 0 };
      entry.total += value;
      entry.count += 1;
      sums.set(key, entry);
    }
  }
  const merged: Record<string, number> = {};
  for (const [key, { total, count }] of sums) {
    merged[key] = total / count;
  }
  return merged;
}

// Averages every provider's raw stats (see convex/providerProjections.ts)
// for one position/season/week into the projections cache every reader
// actually uses - see that table's schema comment for why it's structured
// this way. QB/RB/WR/TE only; K/DST are written directly by convex/
// sleeper/projections.ts and never touch this. Deliberately a single
// mutation (not split into a query + mutation from an action) so the read
// of providerProjections/players and the projections write commit
// atomically - a concurrent provider fetch can't produce a half-blended row.
export const blendProjections = internalMutation({
  args: {
    position: positionValidator,
    season: v.string(),
    week: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ upserted: number; removed: number }> => {
    const providerRows = await ctx.db
      .query("providerProjections")
      .withIndex("by_position_season_week", (q) =>
        q
          .eq("position", args.position)
          .eq("season", args.season)
          .eq("week", args.week),
      )
      .collect();

    // No provider data at all for this slice yet (e.g. blend ran before any
    // fetch completed) - bail out rather than calling upsertProjections
    // with an empty row list, which would delete every existing row for
    // this position/week as "no longer seen".
    if (providerRows.length === 0) {
      return { upserted: 0, removed: 0 };
    }

    const rowsByFpid = new Map<number, typeof providerRows>();
    for (const row of providerRows) {
      const list = rowsByFpid.get(row.fpid) ?? [];
      list.push(row);
      rowsByFpid.set(row.fpid, list);
    }

    const rows = [];
    for (const [fpid, providerRowsForFpid] of rowsByFpid) {
      const player = await ctx.db
        .query("players")
        .withIndex("by_fpid", (q) => q.eq("fpid", fpid))
        .first();
      // providerProjections is only ever written for fpids already in
      // players (see sleeper/projections.ts and espn/rankings.ts's
      // matching) - a miss here would mean the player row was deleted out
      // from under an otherwise-valid provider row; skip rather than throw.
      if (!player) continue;

      const perProviderPoints = providerRowsForFpid.map((row) =>
        computeProjectedPoints(row.stats),
      );

      rows.push({
        fpid,
        name: player.name,
        team: player.team,
        pointsStd: average(perProviderPoints.map((p) => p.pointsStd)),
        pointsHalf: average(perProviderPoints.map((p) => p.pointsHalf)),
        pointsPpr: average(perProviderPoints.map((p) => p.pointsPpr)),
        stats: mergeStats(providerRowsForFpid.map((row) => row.stats)),
      });
    }

    return await ctx.runMutation(api.projections.upsertProjections, {
      position: args.position,
      season: args.season,
      week: args.week,
      rows,
    });
  },
});

// Public, admin-triggered counterpart that runs blendProjections for every
// blended position - see convex/positions.ts's BLENDED_POSITIONS. The
// nightly cron (convex/fetchAllData.ts) calls blendProjections per-position
// directly instead of this, since it already runs with no signed-in user;
// this exists so the Settings > Data panel's "Fetch projections"/"Fetch ESPN
// values" buttons have a manual way to turn whatever raw provider stats
// already landed into the projections rows the rest of the app reads,
// without waiting for the nightly cron.
export const blendAllProjections = action({
  args: { season: v.optional(v.string()), week: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<Record<string, { upserted: number; removed: number }>> => {
    await requireSuperAdmin(ctx);
    const season = args.season ?? currentSeason();

    const results: Record<string, { upserted: number; removed: number }> = {};
    for (const position of BLENDED_POSITIONS) {
      results[position] = await ctx.runMutation(
        internal.projectionBlending.blendProjections,
        { position, season, week: args.week },
      );
    }
    return results;
  },
});
