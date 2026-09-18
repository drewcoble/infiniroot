import { v } from "convex/values";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";
import { POSITIONS, positionValidator } from "./positions";
import { ALL_SCORING_CONFIGS, pointsForScoringConfig, type ScoringConfig } from "./scoring";

type Position = (typeof POSITIONS)[number];

function comboKey(config: ScoringConfig): string {
  return `${config.scoring}|${config.teScoring}|${config.sixPointPassTds}`;
}

// Rebuilds one position's full rosProjTotals combo set from every remaining
// week's own `projections` row - called once per position daily from
// convex/fetchAllData.ts's refreshCachedComputations, before rosVor's own
// per-season refresh reads this cache. One query per remaining week (not
// per scoring combo - each row's raw stats get run through
// pointsForScoringConfig for all 18 combos in memory), same "read once,
// derive many ways" shape convex/lib/playerValue.ts's gatherPlayerForms
// uses. Bye weeks fall out for free: a bye week has no projections row for
// that fpid, so it simply never contributes to the sum.
export const refreshRosProjTotals = internalMutation({
  args: { position: positionValidator, week: v.string() },
  handler: async (ctx, args) => {
    // Same off-season/pre-draft sentinel guard as convex/rosVor.ts's
    // refreshRosVor - no "remaining weeks" concept for week 0, and nothing
    // for a week already past 18.
    const weekNum = Number(args.week);
    const weeks: string[] = [];
    if (Number.isInteger(weekNum) && weekNum >= 1 && weekNum <= 18) {
      for (let w = weekNum; w <= 18; w += 1) weeks.push(String(w));
    }

    const totalsByFpid = new Map<number, Map<string, { totalPoints: number; weeksIncluded: number }>>();
    for (const week of weeks) {
      const rows = await ctx.db
        .query("projections")
        .withIndex("by_position_week", (q) => q.eq("position", args.position).eq("week", week))
        .collect();
      for (const row of rows) {
        let byCombo = totalsByFpid.get(row.fpid);
        if (!byCombo) {
          byCombo = new Map();
          totalsByFpid.set(row.fpid, byCombo);
        }
        for (const config of ALL_SCORING_CONFIGS) {
          const key = comboKey(config);
          const points = pointsForScoringConfig(row, config);
          const existing = byCombo.get(key) ?? { totalPoints: 0, weeksIncluded: 0 };
          existing.totalPoints += points;
          existing.weeksIncluded += 1;
          byCombo.set(key, existing);
        }
      }
    }

    // Full delete+reinsert for this position, same "no history, just
    // current" cache-refresh pattern convex/valueGaps.ts's
    // refreshValueGapsForCombo uses.
    const existing = await ctx.db
      .query("rosProjTotals")
      .withIndex("by_position_scoring_teScoring_sixPointPassTds", (q) => q.eq("position", args.position))
      .collect();
    for (const row of existing) await ctx.db.delete(row._id);

    const now = Date.now();
    for (const [fpid, byCombo] of totalsByFpid) {
      for (const config of ALL_SCORING_CONFIGS) {
        const totals = byCombo.get(comboKey(config));
        if (!totals) continue;
        await ctx.db.insert("rosProjTotals", {
          fpid,
          position: args.position,
          scoring: config.scoring,
          teScoring: config.teScoring,
          sixPointPassTds: config.sixPointPassTds,
          asOfWeek: args.week,
          totalPoints: totals.totalPoints,
          weeksIncluded: totals.weeksIncluded,
          computedAt: now,
        });
      }
    }
  },
});

// Batched read for convex/rosVor.ts - one query per active position (not
// per player), same reasoning as gatherPlayerForms. Missing entries (this
// combo's daily refresh hasn't run yet, or a player has no projections at
// all) are simply absent from the returned map - callers should treat that
// as a cache miss and fall back accordingly, not as a real zero.
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
