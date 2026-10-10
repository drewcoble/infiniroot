import { v } from "convex/values";
import { internalMutation, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { POSITIONS, positionValidator } from "./positions";
import { bonusPoints, pointsForScoring, scoringConfigFromSeason, scoringConfigValidator, type ScoringConfig } from "./scoring";

// Rebuilds weekPositionRankSets (see its schema comment) for the given
// weeks of one season, for every scoring setup a league currently uses.
// Called by the playerWeekPoints sync (convex/sleeper/playerPoints.ts)
// right after it writes those same weeks. One mutation per position-week:
// each reads that position-week's rows once and ranks them under every
// scoring setup.
export async function refreshWeekPositionRanks(
  ctx: ActionCtx,
  args: { season: string; weeks: string[] },
): Promise<void> {
  const seasons = await ctx.runQuery(internal.leagues.listAllSeasons, {});
  const configs = new Map<string, ScoringConfig>();
  for (const season of seasons) {
    const config = scoringConfigFromSeason(season);
    configs.set(`${config.scoring}|${config.teScoring}|${config.sixPointPassTds}`, config);
  }
  if (configs.size === 0) return;

  for (const week of args.weeks) {
    for (const position of POSITIONS) {
      await ctx.runMutation(internal.weekPositionRanks.refreshPositionWeek, {
        season: args.season,
        week,
        position,
        scoringConfigs: [...configs.values()],
      });
    }
  }
}

export const refreshPositionWeek = internalMutation({
  args: {
    season: v.string(),
    week: v.string(),
    position: positionValidator,
    scoringConfigs: v.array(scoringConfigValidator),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("playerWeekPoints")
      .withIndex("by_position_week_season", (q) =>
        q.eq("position", args.position).eq("week", args.week).eq("season", args.season),
      )
      .collect();
    if (rows.length === 0) return;

    for (const config of args.scoringConfigs) {
      // Same points formula and tie rule as convex/lib/weekPoints.ts +
      // getWeekPositionRanks (Matchup tab), over the same rows, so the two
      // can never disagree.
      const scored = rows
        .map((row) => ({
          fpid: row.fpid,
          played: (row.stats.gp ?? 0) > 0,
          points: pointsForScoring(row, config.scoring) + bonusPoints({ position: row.position, stats: row.stats }, config),
        }))
        .sort((a, b) => b.points - a.points);
      const ranks: Array<{ fpid: number; rank: number }> = [];
      let previous: { points: number; rank: number } | null = null;
      scored.forEach((entry, index) => {
        const rank = previous && entry.points === previous.points ? previous.rank : index + 1;
        previous = { points: entry.points, rank };
        if (entry.played) ranks.push({ fpid: entry.fpid, rank });
      });

      const existing = await ctx.db
        .query("weekPositionRankSets")
        .withIndex("by_key", (q) =>
          q
            .eq("season", args.season)
            .eq("position", args.position)
            .eq("scoring", config.scoring)
            .eq("teScoring", config.teScoring)
            .eq("sixPointPassTds", config.sixPointPassTds)
            .eq("week", args.week),
        )
        .unique();
      if (existing) {
        const unchanged =
          existing.ranks.length === ranks.length &&
          existing.ranks.every((entry, i) => entry.fpid === ranks[i]!.fpid && entry.rank === ranks[i]!.rank);
        if (!unchanged) await ctx.db.patch(existing._id, { ranks, updatedAt: Date.now() });
      } else {
        await ctx.db.insert("weekPositionRankSets", {
          season: args.season,
          week: args.week,
          position: args.position,
          ...config,
          ranks,
          updatedAt: Date.now(),
        });
      }
    }
  },
});
