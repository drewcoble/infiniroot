import { v, type Infer } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { positionValidator } from "../positions";
import { fetchSleeper, POSITION_SLUGS } from "./client";
import { parseSleeperStatsRecords, type SleeperStatsRecord } from "./playerPoints";

// A game counts as live from shortly before kickoff until well after it
// should have ended - nflGames only has kickoff times (estimatedEndAt is
// just kickoff + 3.5h, see tank01/schedule.ts), so the extra hour covers
// overtime, delays, and Sleeper's stats settling after the final whistle.
// Anything later than that (a long weather delay, a stat correction) is
// picked up by the daily playerPoints sync instead.
const LIVE_LEAD_MS = 5 * 60 * 1000;
const LIVE_TAIL_MS = 4.5 * 60 * 60 * 1000;

const liveEntryValidator = v.object({
  fpid: v.number(),
  position: positionValidator,
  ptsStd: v.number(),
  ptsHalf: v.number(),
  ptsPpr: v.number(),
  rec: v.number(),
  passTd: v.number(),
});

// Which (season, week)s have a game inside its live window right now.
// Checks the current week and the one before it: Sleeper's week (which
// nflState and nflGames are both tagged with) can roll over while the
// previous week's Monday night game is still finishing, and that game's
// points belong to its own week.
export const getLiveWeeks = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, args): Promise<Array<{ season: string; week: string }>> => {
    const nflState = await ctx.db.query("nflState").first();
    if (!nflState || nflState.seasonType !== "regular") return [];

    const currentWeek = Number(nflState.week);
    const weeks = [currentWeek - 1, currentWeek].filter((w) => w >= 1).map(String);
    const live: Array<{ season: string; week: string }> = [];
    for (const week of weeks) {
      const games = await ctx.db
        .query("nflGames")
        .withIndex("by_season_week", (q) => q.eq("season", nflState.season).eq("week", week))
        .collect();
      const anyLive = games.some(
        (game) => args.now >= game.kickoffAt - LIVE_LEAD_MS && args.now <= game.kickoffAt + LIVE_TAIL_MS,
      );
      if (anyLive) live.push({ season: nflState.season, week });
    }
    return live;
  },
});

type LiveEntry = Infer<typeof liveEntryValidator>;

// Field-by-field rather than JSON.stringify - a stored document's object
// key order isn't guaranteed to match the order these were built in.
function sameEntries(a: LiveEntry[], b: LiveEntry[]): boolean {
  return (
    a.length === b.length &&
    a.every((x, i) => {
      const y = b[i]!;
      return (
        x.fpid === y.fpid &&
        x.position === y.position &&
        x.ptsStd === y.ptsStd &&
        x.ptsHalf === y.ptsHalf &&
        x.ptsPpr === y.ptsPpr &&
        x.rec === y.rec &&
        x.passTd === y.passTd
      );
    })
  );
}

// Writes only when the week's entries actually changed - an unchanged poll
// (between scoring plays, or the tail end of a game window) costs one read
// and doesn't re-run every Players tab subscribed to this document.
export const upsertLiveWeekPoints = internalMutation({
  args: {
    season: v.string(),
    week: v.string(),
    players: v.array(liveEntryValidator),
  },
  handler: async (ctx, args): Promise<{ changed: boolean }> => {
    const existing = await ctx.db
      .query("liveWeekPoints")
      .withIndex("by_season_week", (q) => q.eq("season", args.season).eq("week", args.week))
      .first();
    if (existing && sameEntries(existing.players, args.players)) {
      return { changed: false };
    }
    const doc = { season: args.season, week: args.week, players: args.players, updatedAt: Date.now() };
    if (existing) {
      await ctx.db.replace(existing._id, doc);
    } else {
      await ctx.db.insert("liveWeekPoints", doc);
    }
    return { changed: true };
  },
});

// Drops every live document other than the given current week's - called
// by the daily sync (fetchAllData.ts), by which point playerPoints has
// that finished week's numbers and the live copy is no longer read.
export const pruneLiveWeekPoints = internalMutation({
  args: { season: v.string(), week: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const rows = await ctx.db.query("liveWeekPoints").collect();
    for (const row of rows) {
      if (row.season !== args.season || row.week !== args.week) {
        await ctx.db.delete(row._id);
      }
    }
  },
});

// The 5-minute cron's entry point (see crons.ts). One Sleeper call per live
// week - the same stats endpoint the daily playerPoints sync reads, so live
// and synced numbers agree once the daily run catches up.
export const pollLivePointsInternal = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const liveWeeks = await ctx.runQuery(internal.sleeper.livePoints.getLiveWeeks, { now: Date.now() });
    for (const { season, week } of liveWeeks) {
      const records: SleeperStatsRecord[] = await fetchSleeper(
        "stats",
        season,
        week,
        Object.values(POSITION_SLUGS),
      );
      const players = parseSleeperStatsRecords(records)
        // Only players who've actually played - one whose game hasn't
        // started yet has no entry and reads as "no points yet", not 0.
        .filter((row) => (row.stats.gp ?? 0) > 0)
        .map((row) => ({
          fpid: row.fpid,
          position: row.position,
          ptsStd: row.ptsStd,
          ptsHalf: row.ptsHalf,
          ptsPpr: row.ptsPpr,
          rec: row.stats.rec ?? 0,
          passTd: row.stats.pass_td ?? 0,
        }))
        // Stable order so upsertLiveWeekPoints' unchanged check isn't
        // fooled by Sleeper returning the same players in a new order.
        .sort((a, b) => a.fpid - b.fpid);
      await ctx.runMutation(internal.sleeper.livePoints.upsertLiveWeekPoints, { season, week, players });
    }
  },
});
