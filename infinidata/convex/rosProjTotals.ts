import { v, type Infer } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalAction, internalMutation } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { POSITIONS, positionValidator } from "./positions";
import type { Doc } from "./_generated/dataModel";
import {
  ALL_SCORING_CONFIGS,
  pointsForScoringConfig,
  scoringConfigValidator,
  type ScoringConfig,
} from "./scoring";
import { sameJson } from "./lib/sameJson";

type Position = (typeof POSITIONS)[number];

function comboKey(config: ScoringConfig): string {
  return `${config.scoring}|${config.teScoring}|${config.sixPointPassTds}`;
}

const totalEntryValidator = v.object({
  fpid: v.number(),
  totalPoints: v.number(),
  weeksIncluded: v.number(),
});
type TotalEntry = Infer<typeof totalEntryValidator>;

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
  handler: async (ctx, args): Promise<void> => {
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

    // One document's worth of totals per (position, combo) - every
    // position is written for every combo, including empty ones, so a
    // position with no remaining projections (off-season, past week 18)
    // has its stale document deleted rather than left behind.
    for (const config of ALL_SCORING_CONFIGS) {
      const key = comboKey(config);
      const byPosition = new Map<Position, TotalEntry[]>(POSITIONS.map((pos) => [pos, []]));
      for (const entry of totalsByFpidPosition.values()) {
        const totals = entry.byCombo.get(key);
        if (!totals) continue;
        byPosition.get(entry.position)!.push({ fpid: entry.fpid, ...totals });
      }
      await ctx.runMutation(internal.rosProjTotals.applyRosProjTotalSets, {
        week: args.week,
        scoringConfig: config,
        // Sorted so an unchanged rebuild compares equal to what's stored.
        sets: [...byPosition].map(([position, totals]) => ({
          position,
          totals: totals.sort((a, b) => a.fpid - b.fpid),
        })),
      });
    }
  },
});

// Writes one scoring combo's per-position documents - each only when its
// totals actually changed (so rosVor's reads and subscriptions aren't woken
// by a no-op), and deleted when a position has no totals at all. asOfWeek
// changing counts as a change, so the bookkeeping stays current.
export const applyRosProjTotalSets = internalMutation({
  args: {
    week: v.string(),
    scoringConfig: scoringConfigValidator,
    sets: v.array(v.object({ position: positionValidator, totals: v.array(totalEntryValidator) })),
  },
  handler: async (ctx, args): Promise<void> => {
    for (const { position, totals } of args.sets) {
      const existing = await getRosProjTotalSet(ctx, { position, scoringConfig: args.scoringConfig });
      if (totals.length === 0) {
        if (existing) await ctx.db.delete(existing._id);
        continue;
      }
      if (existing && existing.asOfWeek === args.week && sameJson(existing.totals, totals)) continue;
      const doc = {
        position,
        ...args.scoringConfig,
        asOfWeek: args.week,
        totals,
        computedAt: Date.now(),
      };
      if (existing) {
        await ctx.db.replace(existing._id, doc);
      } else {
        await ctx.db.insert("rosProjTotalSets", doc);
      }
    }
  },
});

async function getRosProjTotalSet(
  ctx: QueryCtx | MutationCtx,
  args: { position: Position; scoringConfig: ScoringConfig },
): Promise<Doc<"rosProjTotalSets"> | null> {
  return await ctx.db
    .query("rosProjTotalSets")
    .withIndex("by_position_scoring_teScoring_sixPointPassTds", (q) =>
      q
        .eq("position", args.position)
        .eq("scoring", args.scoringConfig.scoring)
        .eq("teScoring", args.scoringConfig.teScoring)
        .eq("sixPointPassTds", args.scoringConfig.sixPointPassTds),
    )
    .unique();
}

// One-off cleanup for the LEGACY row-per-player rosProjTotals table
// (replaced by rosProjTotalSets - see schema.ts): deletes every row so that
// table's definition can be removed. Nothing reads it any more, so this is
// safe to run any time. Paginated and self-rescheduling, same as
// convex/valueGaps.ts's clearValueGaps.
export const clearRosProjTotals = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("rosProjTotals")
      .paginate({ cursor: args.cursor ?? null, numItems: 500 });
    for (const row of result.page) {
      await ctx.db.delete(row._id);
    }
    if (!result.isDone) {
      await ctx.scheduler.runAfter(0, internal.rosProjTotals.clearRosProjTotals, {
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
    const set = await getRosProjTotalSet(ctx, { position, scoringConfig: args.scoringConfig });
    for (const entry of set?.totals ?? []) {
      totals.set(entry.fpid, { totalPoints: entry.totalPoints, weeksIncluded: entry.weeksIncluded });
    }
  }
  return totals;
}
