import { v } from "convex/values";
import { query } from "../../_generated/server";
import { requireSeasonOwner } from "../../lib/access";
import { isUsagePosition, projectedUsageScore, usageScore, type UsageScore } from "../../lib/usageScore";
import { normalizeNflTeam } from "../../lib/liveGames";
import { scoringConfigFromSeason } from "../../scoring";
import { loadPlayerSeason } from "./gameLog";

export interface UsageWeek extends UsageScore {
  week: number;
  // Same weeks as the game log: "played", "dnp" (his team played, he
  // didn't), or "bye" - the score parts are 0 for the last two. Plus
  // "projected": the current week before he's played it, `total` only
  // (the projected score, see lib/usageScore.ts's projectedUsageScore).
  kind: "played" | "dnp" | "bye" | "projected";
}

// One player's weekly usage score for one NFL season, in this league's
// scoring (see lib/usageScore.ts) - the player popover's usage chart.
// `average` is across the games he played (null before his first) - the
// projected current week never counts toward it. Null
// for a player who isn't in the players table or plays a position the score
// doesn't cover (K, DST).
export const getUsageWeeks = query({
  args: { seasonId: v.id("seasons"), fpid: v.number(), year: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ position: "QB" | "RB" | "WR" | "TE"; weeks: UsageWeek[]; average: number | null } | null> => {
    const { season } = await requireSeasonOwner(ctx, args.seasonId);
    const config = scoringConfigFromSeason(season);
    const loaded = await loadPlayerSeason(ctx, { fpid: args.fpid, year: args.year, config });
    if (!loaded) return null;
    const position = loaded.position;
    if (!isUsagePosition(position)) return null;

    const weeks: UsageWeek[] = loaded.weeks.map((week) =>
      week.row
        ? { week: week.week, kind: week.kind, ...usageScore(week.row.stats, position, config) }
        : { week: week.week, kind: week.kind, pass: 0, rush: 0, rec: 0, total: 0, expectedPoints: 0 },
    );
    // The current week's projection, once - not if he's already played
    // it (or missed it), and only for the season in progress, since the
    // projections table only holds the current season.
    const nflState = await ctx.db.query("nflState").first();
    if (nflState?.seasonType === "regular" && nflState.season === args.year) {
      const currentWeek = Number(nflState.week);
      if (!weeks.some((week) => week.week === currentWeek)) {
        const projection = await ctx.db
          .query("projections")
          .withIndex("by_position_week_fpid", (q) =>
            q.eq("position", position).eq("week", nflState.week).eq("fpid", args.fpid),
          )
          .first();
        const total = projection ? projectedUsageScore(projection.stats, position, config) : 0;
        if (total > 0) {
          weeks.push({ week: currentWeek, kind: "projected", pass: 0, rush: 0, rec: 0, total, expectedPoints: 0 });
        }
      }
    }

    const played = weeks.filter((week) => week.kind === "played");
    const average =
      played.length > 0 ? played.reduce((sum, week) => sum + week.total, 0) / played.length : null;
    return { position, weeks, average };
  },
});

const GAME_OVER_MS = 4.5 * 60 * 60 * 1000;

// Each player's actual usage score for one week, in this league's scoring,
// once his game is final - the Players / Free Agents tabs show the
// projected score (getRosVorBoard's weekUsage) until then. Reads the live
// document while there is one (its game status says which games are over;
// without status, a game counts as over 4.5 hours after kickoff - same
// window as the live poll), else the synced weekly stats.
export const getWeekUsage = query({
  args: { seasonId: v.id("seasons"), week: v.string() },
  handler: async (ctx, args): Promise<Array<{ fpid: number; usage: number }>> => {
    const { season } = await requireSeasonOwner(ctx, args.seasonId);
    const nflState = await ctx.db.query("nflState").first();
    if (!nflState) return [];
    const config = scoringConfigFromSeason(season);

    const liveWeek = await ctx.db
      .query("liveWeekPoints")
      .withIndex("by_season_week", (q) => q.eq("season", nflState.season).eq("week", args.week))
      .first();
    if (liveWeek) {
      const finalTeams = new Set<string>();
      if (liveWeek.games) {
        for (const game of liveWeek.games) if (game.state === "post") finalTeams.add(game.team);
      } else {
        const games = await ctx.db
          .query("nflGames")
          .withIndex("by_season_week", (q) => q.eq("season", nflState.season).eq("week", args.week))
          .collect();
        const now = Date.now();
        for (const game of games) {
          if (now > game.kickoffAt + GAME_OVER_MS) {
            finalTeams.add(normalizeNflTeam(game.homeTeam));
            finalTeams.add(normalizeNflTeam(game.awayTeam));
          }
        }
      }
      return liveWeek.players.flatMap((entry) =>
        entry.team && entry.usageStats && finalTeams.has(entry.team) && isUsagePosition(entry.position)
          ? [{ fpid: entry.fpid, usage: usageScore(entry.usageStats, entry.position, config).total }]
          : [],
      );
    }

    const rows = await ctx.db
      .query("playerWeekPoints")
      .withIndex("by_season_week_fpid", (q) => q.eq("season", nflState.season).eq("week", args.week))
      .collect();
    return rows.flatMap((row) =>
      isUsagePosition(row.position) && (row.stats.gp ?? 0) > 0
        ? [{ fpid: row.fpid, usage: usageScore(row.stats, row.position, config).total }]
        : [],
    );
  },
});
