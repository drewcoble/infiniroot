import { v } from "convex/values";
import { internalMutation, mutation, query, MutationCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { requireSeasonOwner, requireSeasonParticipant } from "../../lib/access";
import { nextWeeklyOccurrence } from "../../lib/timezone";
import { isFpidEligible } from "./eligibility";

// Freezes resolved*  on every faAuctionState row in the cycle and marks it
// closed - no roster writes (this is a coordination tool, not a source of
// truth for rosters - see AUCTION_PLAN). Re-checks eligibility (see
// eligibility.ts) right before freezing each winner: if a player cleared
// waivers (or got synced as a real add on the platform) before the cycle
// actually closed, that player's result is voided (resolvedAt set,
// resolvedWinnerTeamId left absent) instead of declaring a false winner.
// Shared between the scheduled closeCycle entrypoint below and
// ensureAuctionCycles' defensive fallback (a stale "open" cycle whose
// closesAt already passed, e.g. if the scheduler somehow missed it) - both
// need the exact same logic, and a mutation can call a plain function
// directly within the same transaction without another runMutation hop.
async function closeCycleHandler(
  ctx: MutationCtx,
  cycleId: Id<"faAuctionCycles">,
): Promise<void> {
  const cycle = await ctx.db.get(cycleId);
  if (!cycle || cycle.status === "closed") return;
  const season = await ctx.db.get(cycle.seasonId);
  if (!season) return;

  const now = Date.now();
  const stateRows = await ctx.db
    .query("faAuctionState")
    .withIndex("by_cycle", (q) => q.eq("cycleId", cycleId))
    .collect();

  for (const state of stateRows) {
    const stillEligible = await isFpidEligible(ctx, season, state.fpid);

    if (stillEligible && state.leadingTeamId !== undefined) {
      await ctx.db.patch(state._id, {
        resolvedWinnerTeamId: state.leadingTeamId,
        resolvedPrice: state.currentPrice,
        resolvedAt: now,
      });
    } else {
      // Voided - the player cleared waivers (or was never bid on) before
      // close. resolvedAt alone (no winner) marks "checked, no result" -
      // distinct from a row that was never reached by close at all.
      await ctx.db.patch(state._id, { resolvedAt: now });
    }
  }

  await ctx.db.patch(cycleId, { status: "closed" });
}

// The scheduled entrypoint ctx.scheduler.runAt actually calls, and what
// placeBid's anti-snipe extension reschedules. No auth check - only ever
// invoked by our own scheduler.
export const closeCycle = internalMutation({
  args: { cycleId: v.id("faAuctionCycles") },
  handler: async (ctx, args): Promise<void> => {
    await closeCycleHandler(ctx, args.cycleId);
  },
});

// Cron-driven (see convex/crons.ts) - for every season with the auction
// enabled, ensure there's an open, non-expired cycle. The scheduler call
// below is what actually fires the close precisely on time; this is the
// self-healing backstop (same philosophy as this codebase's other syncs)
// in case a scheduled job was somehow lost.
export const ensureAuctionCycles = internalMutation({
  args: {},
  handler: async (ctx): Promise<void> => {
    const settingsRows = await ctx.db.query("faAuctionSettings").collect();
    const now = Date.now();

    for (const settings of settingsRows) {
      if (!settings.enabled) continue;

      const openCycle = await ctx.db
        .query("faAuctionCycles")
        .withIndex("by_season_status", (q) =>
          q.eq("seasonId", settings.seasonId).eq("status", "open"),
        )
        .first();

      if (openCycle) {
        if (openCycle.closesAt > now) continue;
        // Expired but still "open" - the scheduler missed it. Close it now
        // before opening the next window.
        await closeCycleHandler(ctx, openCycle._id);
      }

      const closesAt = nextWeeklyOccurrence(
        now,
        settings.closeWeekday,
        settings.closeHour,
        settings.closeMinute,
        settings.timeZone,
      );
      const cycleId = await ctx.db.insert("faAuctionCycles", {
        seasonId: settings.seasonId,
        opensAt: now,
        closesAt,
        status: "open",
      });
      const jobId = await ctx.scheduler.runAt(
        closesAt,
        internal.infinileague.auction.cycles.closeCycle,
        { cycleId },
      );
      await ctx.db.patch(cycleId, { closeJobId: jobId });
    }
  },
});

export const getCurrentCycle = query({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args): Promise<Doc<"faAuctionCycles"> | null> => {
    await requireSeasonParticipant(ctx, args.seasonId);
    return await ctx.db
      .query("faAuctionCycles")
      .withIndex("by_season_status", (q) =>
        q.eq("seasonId", args.seasonId).eq("status", "open"),
      )
      .first();
  },
});

// Commissioner-only manual override, mainly for testing: opens a cycle
// right now instead of waiting for the next scheduled closeWeekday/
// closeHour, with a commissioner-chosen duration rather than the real
// weekly schedule. Independent of faAuctionSettings.enabled - a
// commissioner should be able to spin up a one-off test window without
// first turning on the recurring weekly cron behavior that flag gates.
export const openAuctionCycleNow = mutation({
  args: { seasonId: v.id("seasons"), durationMinutes: v.number() },
  handler: async (ctx, args): Promise<Id<"faAuctionCycles">> => {
    await requireSeasonOwner(ctx, args.seasonId);
    if (!Number.isFinite(args.durationMinutes) || args.durationMinutes <= 0) {
      throw new Error("Duration must be a positive number of minutes.");
    }

    const existingOpen = await ctx.db
      .query("faAuctionCycles")
      .withIndex("by_season_status", (q) =>
        q.eq("seasonId", args.seasonId).eq("status", "open"),
      )
      .first();
    if (existingOpen) {
      throw new Error(
        "There's already an open auction cycle - close it first if you want to start a fresh one.",
      );
    }

    const now = Date.now();
    const closesAt = now + args.durationMinutes * 60 * 1000;
    const cycleId = await ctx.db.insert("faAuctionCycles", {
      seasonId: args.seasonId,
      opensAt: now,
      closesAt,
      status: "open",
    });
    const jobId = await ctx.scheduler.runAt(
      closesAt,
      internal.infinileague.auction.cycles.closeCycle,
      { cycleId },
    );
    await ctx.db.patch(cycleId, { closeJobId: jobId });
    return cycleId;
  },
});

// Commissioner-only manual override: closes the open cycle immediately
// rather than waiting for closesAt (including a manually-opened test
// window's own short duration) - the other half of being able to iterate
// on a test auction quickly instead of waiting it out.
export const closeAuctionCycleNow = mutation({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args): Promise<void> => {
    await requireSeasonOwner(ctx, args.seasonId);
    const cycle = await ctx.db
      .query("faAuctionCycles")
      .withIndex("by_season_status", (q) =>
        q.eq("seasonId", args.seasonId).eq("status", "open"),
      )
      .first();
    if (!cycle) {
      throw new Error("There's no open auction cycle to close.");
    }
    if (cycle.closeJobId) {
      await ctx.scheduler.cancel(cycle.closeJobId);
    }
    await closeCycleHandler(ctx, cycle._id);
  },
});

export interface AuctionResultRow {
  cycleId: Id<"faAuctionCycles">;
  closesAt: number;
  fpid: number;
  playerName: string | null;
  winnerTeamName: string | null;
  price: number | null;
}

// Resolved cycles' results, newest cycle first - infinifaab's Results tab.
export const listResults = query({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args): Promise<AuctionResultRow[]> => {
    await requireSeasonParticipant(ctx, args.seasonId);
    const closedCycles = await ctx.db
      .query("faAuctionCycles")
      .withIndex("by_season_status", (q) =>
        q.eq("seasonId", args.seasonId).eq("status", "closed"),
      )
      .collect();
    closedCycles.sort((a, b) => b.closesAt - a.closesAt);

    const rows: AuctionResultRow[] = [];
    for (const cycle of closedCycles) {
      const stateRows = await ctx.db
        .query("faAuctionState")
        .withIndex("by_cycle", (q) => q.eq("cycleId", cycle._id))
        .collect();
      for (const state of stateRows) {
        if (state.resolvedAt === undefined) continue;
        const player = await ctx.db
          .query("players")
          .withIndex("by_fpid", (q) => q.eq("fpid", state.fpid))
          .first();
        const winnerTeam =
          state.resolvedWinnerTeamId !== undefined
            ? await ctx.db.get(state.resolvedWinnerTeamId)
            : null;
        rows.push({
          cycleId: cycle._id,
          closesAt: cycle.closesAt,
          fpid: state.fpid,
          playerName: player?.name ?? null,
          winnerTeamName: winnerTeam?.name ?? null,
          price: state.resolvedPrice ?? null,
        });
      }
    }
    return rows;
  },
});
