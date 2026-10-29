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
import { POSITIONS, positionValidator } from "./positions";

type Position = (typeof POSITIONS)[number];

const gameValidator = v.object({
  fpid: v.number(),
  position: positionValidator,
  opponent: v.string(),
  stats: v.record(v.string(), v.number()),
});

// One week's parsed stats rows (sleeper/playerPoints.ts's
// parseSleeperStatsRecords) as matchupGameWeeks games: played QB/RB/WR/TE
// games with an opponent, stats trimmed to the matchup keys, zeros
// dropped. Sorted so an unchanged week compares equal to the stored doc.
export function toMatchupGameRows(
  rows: Array<{ fpid: number; position: Position; opponent: string | null; stats: Record<string, number> }>,
): Array<{ fpid: number; position: Position; opponent: string; stats: Record<string, number> }> {
  const games = [];
  for (const row of rows) {
    if (!row.opponent || (row.stats.gp ?? 0) <= 0 || !isMatchupPosition(row.position)) continue;
    const stats: Record<string, number> = {};
    for (const key of positionStatKeys(row.position)) {
      const value = row.stats[key];
      if (value) stats[key] = value;
    }
    games.push({ fpid: row.fpid, position: row.position, opponent: normalizeNflTeam(row.opponent), stats });
  }
  return games.sort((a, b) => a.fpid - b.fpid);
}

// Writes one week's games, only if they changed. Returns whether they did -
// the sync rebuilds defenseMatchupSets only then.
export const saveWeekGames = internalMutation({
  args: { season: v.string(), week: v.number(), games: v.array(gameValidator) },
  handler: async (ctx, args): Promise<boolean> => {
    const existing = await ctx.db
      .query("matchupGameWeeks")
      .withIndex("by_season_week", (q) => q.eq("season", args.season).eq("week", args.week))
      .unique();
    if (existing) {
      if (sameJson(existing.games, args.games)) return false;
      await ctx.db.patch(existing._id, { games: args.games, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("matchupGameWeeks", { ...args, updatedAt: Date.now() });
    }
    return true;
  },
});

// Rebuilds one season's defenseMatchupSets (see its schema comment) from
// matchupGameWeeks - every throughWeek from `fromWeek` (the earliest week
// whose games changed; a set only covers weeks up to its own) to the last
// week with games. Called by the Sleeper stats sync (convex/sleeper/
// playerPoints.ts) after saveWeekGames reports a change.
export async function refreshDefenseMatchups(
  ctx: ActionCtx,
  args: { season: string; fromWeek: number },
): Promise<void> {
  const games = await ctx.runQuery(internal.defenseMatchups.listSeasonGames, { season: args.season });
  const lastWeek = Math.max(0, ...games.map((game) => game.week));
  const firstWeek = Math.max(MATCHUP_FIRST_WEEK - 1, args.fromWeek);
  for (let throughWeek = firstWeek; throughWeek <= lastWeek; throughWeek += 1) {
    await ctx.runMutation(internal.defenseMatchups.saveSet, {
      season: args.season,
      throughWeek,
      rows: buildDefenseMatchups(games, throughWeek),
    });
  }
}

export const listSeasonGames = internalQuery({
  args: { season: v.string() },
  handler: async (ctx, args): Promise<MatchupGame[]> => {
    const weeks = await ctx.db
      .query("matchupGameWeeks")
      .withIndex("by_season_week", (q) => q.eq("season", args.season))
      .collect();
    return weeks.flatMap((week) =>
      week.games.flatMap((game) =>
        isMatchupPosition(game.position) ? [{ ...game, position: game.position, week: week.week }] : [],
      ),
    );
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
