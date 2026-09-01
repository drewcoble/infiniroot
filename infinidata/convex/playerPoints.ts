import { v } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
  MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { positionValidator, POSITIONS } from "./positions";
import {
  bonusPoints,
  scoringConfigValidator,
  scoringValidator,
  Scoring,
  ScoringConfig,
  TeScoring,
} from "./scoring";

type Position = (typeof POSITIONS)[number];

const TE_SCORINGS: TeScoring[] = ["NONE", "HALF", "FULL"];

// Every teScoring x sixPointPassTds combination playerSeasonStats stores a
// row for, on top of the 3-way base `scoring` already looped over by this
// file's caller (see sleeper/playerPoints.ts). Uniform for every position
// even though the TE bonus only ever changes a TE row's total and the
// passing bonus only ever changes a row with pass_td stats (bonusPoints in
// convex/scoring.ts is 0 for every other case) - branching per position to
// skip the no-op combos would save rows but isn't worth the complexity for a
// digest table this small (see playerSeasonStats's schema comment).
const BONUS_VARIANTS: Array<Pick<ScoringConfig, "teScoring" | "sixPointPassTds">> =
  TE_SCORINGS.flatMap((teScoring) =>
    [false, true].map((sixPointPassTds) => ({ teScoring, sixPointPassTds })),
  );

function statsEqual(
  a: Record<string, number> | undefined,
  b: Record<string, number> | undefined,
): boolean {
  const aKeys = Object.keys(a ?? {});
  const bKeys = Object.keys(b ?? {});
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => a![key] === b?.[key]);
}

// Downside semi-deviation of per-game points for one bonus variant: squared
// shortfalls below `mean` only (games at or above the mean contribute 0).
// Can't be folded into the incremental sum-of-squares trick below, because
// whether a given game counts as "below" depends on the season's final mean,
// which shifts with every new game. Takes the season's already-fetched
// playerPoints rows (shared across every BONUS_VARIANTS combo by
// applySeasonStatsDelta below) rather than re-querying per variant.
function computeDownsideDeviation(
  rows: Array<{ points: number; stats?: Record<string, number> }>,
  args: { position: Position; config: ScoringConfig; mean: number; gamesPlayed: number },
): number {
  if (args.gamesPlayed === 0) return 0;
  const sumSquaredShortfall = rows.reduce((sum, row) => {
    if (row.points <= 0) return sum; // didn't play - see rule below
    const points =
      row.points +
      bonusPoints({ position: args.position, stats: row.stats ?? {} }, args.config);
    const shortfall = Math.min(points - args.mean, 0);
    return sum + shortfall * shortfall;
  }, 0);
  return Math.sqrt(sumSquaredShortfall / args.gamesPlayed);
}

// Mirrors valueGaps.ts's old in-query rule: Sleeper returns a 0-point stub
// row for rostered-but-inactive players, so a 0-point week counts as "didn't
// play" rather than a played game with 0 points - `old`/`new` are null
// exactly when that game doesn't count. Fans out to one playerSeasonStats
// row per BONUS_VARIANTS combo, since bonusPoints (TE-premium reception
// bonus, 6pt-passing-TD bump) depends on the raw stats blob, not just the
// single scoring-resolved `points` value this used to take.
async function applySeasonStatsDelta(
  ctx: MutationCtx,
  args: {
    fpid: number;
    position: Position;
    season: string;
    scoring: Scoring;
    old: { points: number; stats: Record<string, number> | undefined } | null;
    new: { points: number; stats: Record<string, number> | undefined } | null;
  },
) {
  const unchanged =
    args.old === null
      ? args.new === null
      : args.new !== null &&
        args.old.points === args.new.points &&
        statsEqual(args.old.stats, args.new.stats);
  if (unchanged) return;

  const gamesDelta = (args.new ? 1 : 0) - (args.old ? 1 : 0);

  // Shared across every bonus variant below - the set of games itself
  // doesn't depend on teScoring/sixPointPassTds, only how each game's points
  // are computed from it.
  const seasonRows = await ctx.db
    .query("playerPoints")
    .withIndex("by_fpid_season_scoring", (q) =>
      q.eq("fpid", args.fpid).eq("season", args.season).eq("scoring", args.scoring),
    )
    .collect();

  for (const { teScoring, sixPointPassTds } of BONUS_VARIANTS) {
    const config: ScoringConfig = { scoring: args.scoring, teScoring, sixPointPassTds };
    const oldPoints = args.old
      ? args.old.points +
        bonusPoints({ position: args.position, stats: args.old.stats ?? {} }, config)
      : 0;
    const newPoints = args.new
      ? args.new.points +
        bonusPoints({ position: args.position, stats: args.new.stats ?? {} }, config)
      : 0;
    const pointsDelta = newPoints - oldPoints;
    const pointsSquaredDelta = newPoints ** 2 - oldPoints ** 2;

    const existing = await ctx.db
      .query("playerSeasonStats")
      .withIndex("by_fpid_season_scoring_teScoring_sixPointPassTds", (q) =>
        q
          .eq("fpid", args.fpid)
          .eq("season", args.season)
          .eq("scoring", args.scoring)
          .eq("teScoring", teScoring)
          .eq("sixPointPassTds", sixPointPassTds),
      )
      .unique();

    const totalPoints = (existing?.totalPoints ?? 0) + pointsDelta;
    const sumSquaredPoints =
      (existing?.sumSquaredPoints ?? 0) + pointsSquaredDelta;
    const gamesPlayed = (existing?.gamesPlayed ?? 0) + gamesDelta;
    // Population variance of per-game points - E[X^2] - E[X]^2, computed from
    // the running sums above rather than re-reading every week's row. Clamped
    // to 0 to absorb floating-point drift for a player whose scores barely vary.
    const variance =
      gamesPlayed > 0
        ? Math.max(
            sumSquaredPoints / gamesPlayed - (totalPoints / gamesPlayed) ** 2,
            0,
          )
        : 0;
    const stdDeviation = Math.sqrt(variance);
    const downsideDeviation = computeDownsideDeviation(seasonRows, {
      position: args.position,
      config,
      mean: gamesPlayed > 0 ? totalPoints / gamesPlayed : 0,
      gamesPlayed,
    });

    const fields = {
      totalPoints,
      sumSquaredPoints,
      gamesPlayed,
      variance,
      stdDeviation,
      downsideDeviation,
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, fields);
    } else {
      await ctx.db.insert("playerSeasonStats", {
        fpid: args.fpid,
        season: args.season,
        position: args.position,
        scoring: args.scoring,
        teScoring,
        sixPointPassTds,
        ...fields,
      });
    }
  }
}

export const getPlayerPoints = query({
  args: { position: positionValidator, week: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("playerPoints")
      .withIndex("by_position_week", (q) =>
        q.eq("position", args.position).eq("week", args.week),
      )
      .collect();
  },
});

// One player's full week-by-week game log for a season - powers the player
// detail modal's per-season accordion panel (see
// src/components/PlayerSeasonGameLog.tsx), fetched lazily only once that
// panel is expanded. A 0-point week is excluded (mirrors the "didn't play"
// convention already used by applySeasonStatsDelta above/valueGaps.ts)
// rather than shown as a played game with nothing recorded.
export const getPlayerGameLog = query({
  args: { fpid: v.number(), season: v.string(), scoring: scoringValidator },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("playerPoints")
      .withIndex("by_fpid_season_scoring", (q) =>
        q
          .eq("fpid", args.fpid)
          .eq("season", args.season)
          .eq("scoring", args.scoring),
      )
      .collect();
    return rows
      .filter((row) => row.points > 0)
      .sort((a, b) => Number(a.week) - Number(b.week));
  },
});

// Season-long digest for one player across several seasons at once - powers
// each accordion header's summary (total/games/PPG) shown before that
// season's panel is expanded, so opening the modal only costs one batched
// call rather than one per season. Seasons with no row (player didn't play,
// or data hasn't been fetched for that far back) are simply omitted.
export const getPlayerSeasonStatsHistory = query({
  args: {
    fpid: v.number(),
    scoringConfig: scoringConfigValidator,
    seasons: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const rows = await Promise.all(
      args.seasons.map((season) =>
        ctx.db
          .query("playerSeasonStats")
          .withIndex("by_fpid_season_scoring_teScoring_sixPointPassTds", (q) =>
            q
              .eq("fpid", args.fpid)
              .eq("season", season)
              .eq("scoring", args.scoringConfig.scoring)
              .eq("teScoring", args.scoringConfig.teScoring)
              .eq("sixPointPassTds", args.scoringConfig.sixPointPassTds),
          )
          .unique(),
      ),
    );
    return rows.filter((row): row is NonNullable<typeof row> => row !== null);
  },
});

// playerSeasonStats rows for one season/scoring config, optionally scoped to
// one position - powers the consistency rating (src/lib/consistency.ts),
// which needs either one position's cohort (the player detail modal,
// scoped) or every position's at once (PlayersTable/PlayersLeftTab,
// unfiltered). Mirrors getAllRankings's loop-over-positions pattern
// (convex/rankings.ts) since no single index covers "every position, one
// season" directly.
export const getAllSeasonStats = query({
  args: {
    season: v.string(),
    scoringConfig: scoringConfigValidator,
    position: v.optional(positionValidator),
  },
  handler: async (ctx, args) => {
    const positions = args.position ? [args.position] : POSITIONS;
    const results = [];
    for (const position of positions) {
      const rows = await ctx.db
        .query("playerSeasonStats")
        .withIndex("by_position_season_scoring_teScoring_sixPointPassTds", (q) =>
          q
            .eq("position", position)
            .eq("season", args.season)
            .eq("scoring", args.scoringConfig.scoring)
            .eq("teScoring", args.scoringConfig.teScoring)
            .eq("sixPointPassTds", args.scoringConfig.sixPointPassTds),
        )
        .collect();
      results.push(...rows);
    }
    return results;
  },
});

export const upsertPlayerPoints = mutation({
  args: {
    season: v.string(),
    scoring: scoringValidator,
    rows: v.array(
      v.object({
        fpid: v.number(),
        position: positionValidator,
        week: v.string(),
        points: v.number(),
        stats: v.record(v.string(), v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let inserted = 0;
    let updated = 0;

    for (const row of args.rows) {
      const existing = await ctx.db
        .query("playerPoints")
        .withIndex("by_season_week_fpid", (q) =>
          q
            .eq("season", args.season)
            .eq("week", row.week)
            .eq("fpid", row.fpid),
        )
        .filter((q) => q.eq(q.field("scoring"), args.scoring))
        .first();

      const oldPoints = existing?.points ?? 0;
      const oldCounted = existing !== null && oldPoints > 0;
      const newCounted = row.points > 0;

      if (existing) {
        await ctx.db.patch(existing._id, {
          points: row.points,
          stats: row.stats,
          fetchedAt: now,
        });
        updated += 1;
      } else {
        await ctx.db.insert("playerPoints", {
          fpid: row.fpid,
          season: args.season,
          week: row.week,
          position: row.position,
          scoring: args.scoring,
          points: row.points,
          stats: row.stats,
          fetchedAt: now,
        });
        inserted += 1;
      }

      await applySeasonStatsDelta(ctx, {
        fpid: row.fpid,
        position: row.position,
        season: args.season,
        scoring: args.scoring,
        old: oldCounted ? { points: oldPoints, stats: existing!.stats } : null,
        new: newCounted ? { points: row.points, stats: row.stats } : null,
      });
    }

    return { inserted, updated };
  },
});

// One-time backfill: playerSeasonStats only gets populated going forward by
// upsertPlayerPoints's incremental deltas above, so any playerPoints rows
// written before this table (or before one of its fields) existed need to be
// folded in separately. Guards against a double-run on the very first batch
// (cursor undefined) - since this accumulates deltas rather than recomputing
// from scratch, running it twice would silently double every season's totals.
// Pair with clearSeasonStats below when the digest's shape changes and needs
// a full rebuild rather than an incremental fold-in.
export const backfillSeasonStats = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (args.cursor === undefined) {
      const alreadyStarted = await ctx.db.query("playerSeasonStats").first();
      if (alreadyStarted) {
        throw new Error(
          "playerSeasonStats already has rows - refusing to backfill again " +
            "(this would double-count). Run clearSeasonStats first if you " +
            "need to rebuild it from scratch.",
        );
      }
    }

    const result = await ctx.db
      .query("playerPoints")
      .paginate({ cursor: args.cursor ?? null, numItems: 500 });

    for (const row of result.page) {
      if (row.points <= 0) continue;
      await applySeasonStatsDelta(ctx, {
        fpid: row.fpid,
        position: row.position,
        season: row.season,
        scoring: row.scoring,
        old: null,
        new: { points: row.points, stats: row.stats },
      });
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.playerPoints.backfillSeasonStats,
        { cursor: result.continueCursor },
      );
    }
  },
});

// Wipes playerSeasonStats so backfillSeasonStats can rebuild it from scratch
// after the digest's shape changes (e.g. adding a new derived stat) - the
// digest has no independent meaning of its own, so clearing and refolding
// playerPoints is always safe and cheaper than a field-by-field migration.
export const clearSeasonStats = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("playerSeasonStats")
      .paginate({ cursor: args.cursor ?? null, numItems: 500 });

    for (const row of result.page) {
      await ctx.db.delete(row._id);
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(0, internal.playerPoints.clearSeasonStats, {
        cursor: result.continueCursor,
      });
    }
  },
});
