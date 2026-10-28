import { v } from "convex/values";
import { internalMutation, internalQuery, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { normalizeNflTeam } from "./lib/liveGames";
import { MATCHUP_FIRST_WEEK } from "./lib/matchupCalibration";
import {
  buildDefenseMatchups,
  isMatchupPosition,
  positionStatKeys,
  type MatchupGame,
} from "./lib/matchupDifficulty";
import { sameJson } from "./lib/sameJson";
import { positionValidator } from "./positions";

const MATCHUP_POSITIONS = ["QB", "RB", "WR", "TE"] as const;
const WEEKS = Array.from({ length: 18 }, (_, i) => i + 1);

// Rebuilds one season's defenseMatchupSets (see its schema comment) - every
// throughWeek from MATCHUP_FIRST_WEEK - 1 to the last week with games.
// Called by the playerWeekPoints sync (convex/sleeper/playerPoints.ts)
// right after it writes. Every set is rebuilt, not just the synced weeks:
// a late stat correction in week 3 shifts that player's baseline in every
// later set too. Reads one week per query (a whole season of QB/RB/WR/TE
// rows is too many for one transaction).
export async function refreshDefenseMatchups(ctx: ActionCtx, args: { season: string }): Promise<void> {
  const games: MatchupGame[] = [];
  for (const week of WEEKS) {
    games.push(...(await ctx.runQuery(internal.defenseMatchups.listWeekGames, { season: args.season, week })));
  }
  const lastWeek = Math.max(0, ...games.map((game) => game.week));
  for (let throughWeek = MATCHUP_FIRST_WEEK - 1; throughWeek <= lastWeek; throughWeek += 1) {
    await ctx.runMutation(internal.defenseMatchups.saveSet, {
      season: args.season,
      throughWeek,
      rows: buildDefenseMatchups(games, throughWeek),
    });
  }
}

// One week's played QB/RB/WR/TE games, trimmed to the matchup stats. Rows
// synced before team/opponent were stored have no opponent and are left out.
export const listWeekGames = internalQuery({
  args: { season: v.string(), week: v.number() },
  handler: async (ctx, args): Promise<MatchupGame[]> => {
    const games: MatchupGame[] = [];
    for (const position of MATCHUP_POSITIONS) {
      const rows = await ctx.db
        .query("playerWeekPoints")
        .withIndex("by_position_week_season", (q) =>
          q.eq("position", position).eq("week", String(args.week)).eq("season", args.season),
        )
        .collect();
      for (const row of rows) {
        if (!row.opponent || (row.stats.gp ?? 0) <= 0 || !isMatchupPosition(row.position)) continue;
        const stats: Record<string, number> = {};
        for (const key of positionStatKeys(row.position)) {
          const value = row.stats[key];
          if (value) stats[key] = value;
        }
        games.push({
          fpid: row.fpid,
          position: row.position,
          week: args.week,
          opponent: normalizeNflTeam(row.opponent),
          stats,
        });
      }
    }
    return games;
  },
});

export const saveSet = internalMutation({
  args: {
    season: v.string(),
    throughWeek: v.number(),
    rows: v.array(
      v.object({
        defense: v.string(),
        position: positionValidator,
        games: v.number(),
        allowed: v.record(v.string(), v.number()),
        baseline: v.record(v.string(), v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("defenseMatchupSets")
      .withIndex("by_season_week", (q) => q.eq("season", args.season).eq("throughWeek", args.throughWeek))
      .unique();
    if (existing) {
      if (!sameJson(existing.rows, args.rows)) {
        await ctx.db.patch(existing._id, { rows: args.rows, updatedAt: Date.now() });
      }
    } else {
      await ctx.db.insert("defenseMatchupSets", { ...args, updatedAt: Date.now() });
    }
  },
});
