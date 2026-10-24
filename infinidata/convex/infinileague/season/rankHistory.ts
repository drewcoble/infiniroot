import { v } from "convex/values";
import { query } from "../../_generated/server";
import { requireSeasonOwner } from "../../lib/access";
import { pointsForScoringConfig, scoringConfigFromSeason } from "../../scoring";

export interface RankHistoryWeek {
  week: number;
  // His position rank by season-to-date points per game after this week -
  // null until he's played enough to qualify (MIN_GAMES_SHARE of the weeks
  // so far), or if he hasn't played at all.
  ppgRank: number | null;
  // ...and by season-to-date total points (no minimum).
  totalRank: number | null;
  ppg: number | null;
  total: number;
  games: number;
}

// Points-per-game ranks only count players who've played at least this
// share of the weeks so far - otherwise one big game ranks a backup first.
const MIN_GAMES_SHARE = 0.5;

// One player's season-to-date position rank after each week of an NFL
// season, in this league's scoring - by points per game and by total
// points. For the Simple mode sandbox's rank timeline (an experiment, not
// yet used elsewhere).
//
// Reads every player-week at his position for the season (~250 rows a
// week for WR), so it's fine for a sandbox but would want a precomputed
// table - like weekPositionRankSets - before going in the player popover.
export const getSeasonRankHistory = query({
  args: { seasonId: v.id("seasons"), fpid: v.number(), year: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ position: string; weeks: RankHistoryWeek[]; rankedCount: number } | null> => {
    const { season } = await requireSeasonOwner(ctx, args.seasonId);
    const config = scoringConfigFromSeason(season);
    const player = await ctx.db
      .query("players")
      .withIndex("by_fpid", (q) => q.eq("fpid", args.fpid))
      .first();
    if (!player) return null;
    const position = player.position;

    const rowsByWeek: Array<Array<{ fpid: number; points: number }>> = [];
    for (let week = 1; week <= 18; week += 1) {
      const rows = await ctx.db
        .query("playerWeekPoints")
        .withIndex("by_position_week_season", (q) =>
          q.eq("position", position).eq("week", String(week)).eq("season", args.year),
        )
        .collect();
      if (rows.length === 0) break;
      rowsByWeek.push(
        rows
          .filter((row) => (row.stats.gp ?? 0) > 0)
          .map((row) => ({ fpid: row.fpid, points: pointsForScoringConfig(row, config) })),
      );
    }

    const totals = new Map<number, { total: number; games: number }>();
    const weeks: RankHistoryWeek[] = [];
    let rankedCount = 0;
    rowsByWeek.forEach((rows, index) => {
      for (const { fpid, points } of rows) {
        const entry = totals.get(fpid) ?? { total: 0, games: 0 };
        entry.total += points;
        entry.games += 1;
        totals.set(fpid, entry);
      }
      const minGames = Math.max(1, Math.ceil((index + 1) * MIN_GAMES_SHARE));
      const everyone = [...totals.entries()];
      const byTotal = [...everyone].sort((a, b) => b[1].total - a[1].total);
      const byPpg = everyone
        .filter(([, entry]) => entry.games >= minGames)
        .sort((a, b) => b[1].total / b[1].games - a[1].total / a[1].games);
      rankedCount = Math.max(rankedCount, byPpg.length);
      const mine = totals.get(args.fpid);
      const ppgIndex = byPpg.findIndex(([fpid]) => fpid === args.fpid);
      const totalIndex = byTotal.findIndex(([fpid]) => fpid === args.fpid);
      weeks.push({
        week: index + 1,
        ppgRank: ppgIndex >= 0 ? ppgIndex + 1 : null,
        totalRank: mine && totalIndex >= 0 ? totalIndex + 1 : null,
        ppg: mine && mine.games > 0 ? mine.total / mine.games : null,
        total: mine?.total ?? 0,
        games: mine?.games ?? 0,
      });
    });

    return { position, weeks, rankedCount };
  },
});
