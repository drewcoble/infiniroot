import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalAction, internalMutation } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { POSITIONS, positionValidator } from "./positions";
import {
  ALL_SCORING_CONFIGS,
  pointsForScoringConfig,
  scoringValidator,
  teScoringValidator,
  type ScoringConfig,
} from "./scoring";

type Position = (typeof POSITIONS)[number];

function comboKey(config: ScoringConfig): string {
  return `${config.scoring}|${config.teScoring}|${config.sixPointPassTds}`;
}

// Rows this run computed, ready to upsert - one per (fpid, position, combo).
interface RosProjTotalRow {
  fpid: number;
  position: Position;
  scoring: ScoringConfig["scoring"];
  teScoring: ScoringConfig["teScoring"];
  sixPointPassTds: boolean;
  totalPoints: number;
  weeksIncluded: number;
}

const rosProjTotalRowValidator = v.object({
  fpid: v.number(),
  position: positionValidator,
  scoring: scoringValidator,
  teScoring: teScoringValidator,
  sixPointPassTds: v.boolean(),
  totalPoints: v.number(),
  weeksIncluded: v.number(),
});

// Rebuilds the whole rosProjTotals cache (every position, every scoring
// combo) from every remaining week's own `projections` rows - called once
// daily from convex/fetchAllData.ts's refreshCachedComputations, before
// rosVor's own per-season refresh reads this cache. An ACTION rather than a
// single mutation: convex/projections.ts's getAllProjections is read once
// per remaining week via its own bounded ctx.runQuery call (a few hundred
// to ~1-2k rows per week, well under Convex's 4096-reads-per-transaction
// limit) and accumulated here in plain JS memory, which has no such cap -
// summing all ~17 remaining weeks inside one mutation execution was
// measured to blow well past that limit (confirmed live - see git history).
// Bye weeks fall out for free: a bye week has no projections row for that
// fpid, so it simply never contributes to the sum.
export const refreshRosProjTotals = internalAction({
  args: { week: v.string() },
  handler: async (ctx, args) => {
    // Same off-season/pre-draft sentinel guard as convex/rosVor.ts's
    // refreshRosVor - no "remaining weeks" concept for week 0, and nothing
    // for a week already past 18.
    const weekNum = Number(args.week);
    const weeks: string[] = [];
    if (Number.isInteger(weekNum) && weekNum >= 1 && weekNum <= 18) {
      for (let w = weekNum; w <= 18; w += 1) weeks.push(String(w));
    }

    const totalsByFpidPosition = new Map<
      string,
      { fpid: number; position: Position; byCombo: Map<string, { totalPoints: number; weeksIncluded: number }> }
    >();

    for (const week of weeks) {
      const rows = await ctx.runQuery(api.projections.getAllProjections, { week });
      for (const row of rows) {
        const mapKey = `${row.fpid}|${row.position}`;
        let entry = totalsByFpidPosition.get(mapKey);
        if (!entry) {
          entry = { fpid: row.fpid, position: row.position, byCombo: new Map() };
          totalsByFpidPosition.set(mapKey, entry);
        }
        for (const config of ALL_SCORING_CONFIGS) {
          const key = comboKey(config);
          const points = pointsForScoringConfig(row, config);
          const existing = entry.byCombo.get(key) ?? { totalPoints: 0, weeksIncluded: 0 };
          existing.totalPoints += points;
          existing.weeksIncluded += 1;
          entry.byCombo.set(key, existing);
        }
      }
    }

    const finalRows: RosProjTotalRow[] = [];
    for (const entry of totalsByFpidPosition.values()) {
      for (const config of ALL_SCORING_CONFIGS) {
        const totals = entry.byCombo.get(comboKey(config));
        if (!totals) continue;
        finalRows.push({
          fpid: entry.fpid,
          position: entry.position,
          scoring: config.scoring,
          teScoring: config.teScoring,
          sixPointPassTds: config.sixPointPassTds,
          totalPoints: totals.totalPoints,
          weeksIncluded: totals.weeksIncluded,
        });
      }
    }

    // Chunked writes, same discipline convex/sleeper/playerPoints.ts's fix
    // for this exact failure mode established - each chunk's mutation call
    // does its own point lookup + patch/insert per row, bounded well under
    // the per-transaction limits regardless of how big finalRows is.
    const CHUNK_SIZE = 200;
    for (let i = 0; i < finalRows.length; i += CHUNK_SIZE) {
      await ctx.runMutation(internal.rosProjTotals.applyRosProjTotalsChunk, {
        week: args.week,
        rows: finalRows.slice(i, i + CHUNK_SIZE),
      });
    }

    // Sweeps out anything this run didn't touch (a player who no longer has
    // a projection this week, etc.) - paginated and self-rescheduling, same
    // pattern convex/valueGaps.ts's clearValueGaps uses, rather than an
    // upfront delete-everything pass (which would race the writes above and
    // re-introduce the same too-many-reads problem at table-wide scale).
    await ctx.runMutation(internal.rosProjTotals.pruneStaleRosProjTotals, {
      currentWeek: args.week,
    });
  },
});

// Upserts one chunk of rows - point lookup (by the full compound key) per
// row rather than a blind insert, so a rerun of the same week patches
// existing rows in place instead of duplicating them.
export const applyRosProjTotalsChunk = internalMutation({
  args: { week: v.string(), rows: v.array(rosProjTotalRowValidator) },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const row of args.rows) {
      const existing = await ctx.db
        .query("rosProjTotals")
        .withIndex("by_fpid_position_scoring_teScoring_sixPointPassTds", (q) =>
          q
            .eq("fpid", row.fpid)
            .eq("position", row.position)
            .eq("scoring", row.scoring)
            .eq("teScoring", row.teScoring)
            .eq("sixPointPassTds", row.sixPointPassTds),
        )
        .unique();
      const fields = {
        totalPoints: row.totalPoints,
        weeksIncluded: row.weeksIncluded,
        asOfWeek: args.week,
        computedAt: now,
      };
      if (existing) {
        await ctx.db.patch(existing._id, fields);
      } else {
        await ctx.db.insert("rosProjTotals", {
          fpid: row.fpid,
          position: row.position,
          scoring: row.scoring,
          teScoring: row.teScoring,
          sixPointPassTds: row.sixPointPassTds,
          ...fields,
        });
      }
    }
  },
});

// Deletes any row whose asOfWeek doesn't match the week that was just
// refreshed - every row touched by applyRosProjTotalsChunk above gets
// asOfWeek stamped to the current run, so anything left behind is stale by
// definition. Paginated, self-rescheduling continuation - same reasoning as
// convex/valueGaps.ts's clearValueGaps (a full-table scan-and-delete can
// easily exceed the per-transaction read limit once this cache has real
// volume).
export const pruneStaleRosProjTotals = internalMutation({
  args: { currentWeek: v.string(), cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("rosProjTotals")
      .paginate({ cursor: args.cursor ?? null, numItems: 200 });
    for (const row of result.page) {
      if (row.asOfWeek !== args.currentWeek) await ctx.db.delete(row._id);
    }
    if (!result.isDone) {
      await ctx.scheduler.runAfter(0, internal.rosProjTotals.pruneStaleRosProjTotals, {
        currentWeek: args.currentWeek,
        cursor: result.continueCursor,
      });
    }
  },
});

// Batched read for convex/rosVor.ts - one query per active position (not
// per player), same reasoning as playerValue.ts's gatherPlayerForms. Missing
// entries (this combo's daily refresh hasn't run yet, or a player has no
// projections at all) are simply absent from the returned map - callers
// should treat that as a cache miss and fall back accordingly, not as a
// real zero.
export async function gatherRosProjTotals(
  ctx: QueryCtx | MutationCtx,
  args: { activePositions: Position[]; scoringConfig: ScoringConfig },
): Promise<Map<number, { totalPoints: number; weeksIncluded: number }>> {
  const totals = new Map<number, { totalPoints: number; weeksIncluded: number }>();
  for (const position of args.activePositions) {
    const rows = await ctx.db
      .query("rosProjTotals")
      .withIndex("by_position_scoring_teScoring_sixPointPassTds", (q) =>
        q
          .eq("position", position)
          .eq("scoring", args.scoringConfig.scoring)
          .eq("teScoring", args.scoringConfig.teScoring)
          .eq("sixPointPassTds", args.scoringConfig.sixPointPassTds),
      )
      .collect();
    for (const row of rows) {
      totals.set(row.fpid, { totalPoints: row.totalPoints, weeksIncluded: row.weeksIncluded });
    }
  }
  return totals;
}
