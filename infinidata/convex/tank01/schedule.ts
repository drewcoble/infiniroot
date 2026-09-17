"use node";

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

async function fetchScheduleHandler(
  ctx: ActionCtx,
): Promise<{ upserted: number; skipped: boolean }> {
  const week = await fetchCurrentNflWeek();
  // "0" is the same offseason/draft-prep sentinel fetchAllData.ts's own
  // week resolution uses - no real week to fetch a schedule for.
  if (week === "0") {
    return { upserted: 0, skipped: true };
  }
  const season = currentSeason();
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

  const result = await ctx.runMutation(
    internal.tank01.scheduleData.upsertWeekSchedule,
    { season, week, games: rows },
  );
  return { upserted: result.upserted, skipped: false };
}

export const fetchSchedule = action({
  args: {},
  handler: async (ctx): Promise<{ upserted: number; skipped: boolean }> => {
    await requireSuperAdmin(ctx);
    return await fetchScheduleHandler(ctx);
  },
});

// Cron-safe counterpart with no human-auth check - see fetchAllData.ts's
// fetchAllInternal for why this split exists.
export const fetchScheduleInternal = internalAction({
  args: {},
  handler: async (ctx) => await fetchScheduleHandler(ctx),
});
