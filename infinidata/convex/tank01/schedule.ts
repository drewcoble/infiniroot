"use node";

import { v } from "convex/values";
import { action, internalAction, ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { requireSuperAdmin, currentSeason, fetchTank01WeeklySchedule } from "./client";
import { fetchCurrentNflWeek } from "../sleeper/state";

// A real NFL game runs ~3-3.5h including pre/post-game - this is a fixed
// approximation of "game over", not a real final-whistle timestamp (Tank01's
// schedule endpoint gives kickoff only). Only ever affects when a player
// *might* clear Sleeper waivers a few minutes early/late (see
// convex/sleeper/transactions.ts) - eligibility is re-checked at auction
// close regardless, so this never affects who actually wins.
const ESTIMATED_GAME_LENGTH_MS = 3.5 * 60 * 60 * 1000;

const REGULAR_SEASON_WEEKS = 18;

// How stale a future week's stored slate can get before it's refetched -
// late-season flex scheduling moves kickoff times, but only ever with ~12
// days' notice, so weekly is fresh enough. Keeps this cron (every 6h) to
// about one extra Tank01 call per future week per week - well inside the
// 1,000/month free tier - instead of refetching ~12 weeks every run.
const FUTURE_WEEK_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;

async function syncWeek(ctx: ActionCtx, season: string, week: string): Promise<number> {
  const games = await fetchTank01WeeklySchedule(week, season);
  const rows = games.map((game) => {
    const kickoffAt = Number(game.gameTime_epoch) * 1000;
    return {
      homeTeam: game.home,
      awayTeam: game.away,
      kickoffAt,
      estimatedEndAt: kickoffAt + ESTIMATED_GAME_LENGTH_MS,
    };
  });
  const result = await ctx.runMutation(internal.tank01.scheduleData.upsertWeekSchedule, {
    season,
    week,
    games: rows,
  });
  return result.upserted;
}

// The current week every run (kickoff times gate bidding - see crons.ts),
// plus each remaining regular-season week that's never been synced or is
// older than FUTURE_WEEK_REFRESH_MS - infinileague's Matchup tab browses
// future weeks and needs their slates. `allWeeks` (the admin button) skips
// the staleness check and refetches every remaining week.
async function fetchScheduleHandler(
  ctx: ActionCtx,
  allWeeks: boolean,
): Promise<{ upserted: number; weeksFetched: number; skipped: boolean }> {
  const week = await fetchCurrentNflWeek();
  // "0" is the same offseason/draft-prep sentinel fetchAllData.ts's own
  // week resolution uses - no real week to fetch a schedule for.
  if (week === "0") {
    return { upserted: 0, weeksFetched: 0, skipped: true };
  }
  const season = currentSeason();
  let upserted = await syncWeek(ctx, season, week);
  let weeksFetched = 1;

  const futureWeeks = Array.from(
    { length: Math.max(REGULAR_SEASON_WEEKS - Number(week), 0) },
    (_, index) => String(Number(week) + index + 1),
  );
  const syncTimes = await ctx.runQuery(internal.tank01.scheduleData.getWeekSyncTimes, {
    season,
    weeks: futureWeeks,
  });
  const now = Date.now();
  // One at a time rather than in parallel - a dozen simultaneous calls is
  // an easy way to trip RapidAPI's per-second limit.
  for (const { week: futureWeek, syncedAt } of syncTimes) {
    if (!allWeeks && syncedAt !== null && now - syncedAt < FUTURE_WEEK_REFRESH_MS) continue;
    upserted += await syncWeek(ctx, season, futureWeek);
    weeksFetched += 1;
  }
  return { upserted, weeksFetched, skipped: false };
}

export const fetchSchedule = action({
  args: { allWeeks: v.optional(v.boolean()) },
  handler: async (
    ctx,
    args,
  ): Promise<{ upserted: number; weeksFetched: number; skipped: boolean }> => {
    await requireSuperAdmin(ctx);
    return await fetchScheduleHandler(ctx, args.allWeeks ?? false);
  },
});

// Cron-safe counterpart with no human-auth check - see fetchAllData.ts's
// fetchAllInternal for why this split exists.
export const fetchScheduleInternal = internalAction({
  args: {},
  handler: async (ctx) => await fetchScheduleHandler(ctx, false),
});
