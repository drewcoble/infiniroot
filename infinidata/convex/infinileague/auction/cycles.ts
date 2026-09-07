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
// eligibility.ts) right before freezing each winner, now passing the cycle
// itself so a dedicated (playerDrop/manual) cycle's looser "just unrostered"
// rule applies instead of the weekly cycle's kickoff gate: if a player
// cleared waivers (or got synced as a real add on the platform) before the
// cycle actually closed, that player's result is voided (resolvedAt set,
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
    const stillEligible = await isFpidEligible(ctx, season, cycle, state.fpid);

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

  // A dedicated cycle's locked fpid(s) are freed back to the pool the
  // instant it closes - a "weekly" cycle never has lock rows to begin with
  // (see schema.ts's faAuctionFpidCycles comment), so this is a no-op there.
  if ((cycle.type ?? "weekly") !== "weekly") {
    const lockRows = await ctx.db
      .query("faAuctionFpidCycles")
      .withIndex("by_cycle", (q) => q.eq("cycleId", cycleId))
      .collect();
    for (const lock of lockRows) {
      await ctx.db.delete(lock._id);
    }
  }
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
// enabled, ensure there's an open, non-expired WEEKLY cycle (dedicated
// playerDrop/manual cycles are created on their own, out-of-band - see
// startManualAuctionCycle below and sleeper/transactions.ts's
// detectSleeperDrops). The scheduler call below is what actually fires each
// cycle's close precisely on time; this loop is the self-healing backstop
// (same philosophy as this codebase's other syncs) in case a scheduled job
// was somehow lost - now generalized to self-heal ANY open cycle's type,
// since a lost close job could in principle happen to a dedicated cycle too.
export const ensureAuctionCycles = internalMutation({
  args: {},
  handler: async (ctx): Promise<void> => {
    const settingsRows = await ctx.db.query("faAuctionSettings").collect();
    const now = Date.now();

    for (const settings of settingsRows) {
      if (!settings.enabled) continue;

      const openCycles = await ctx.db
        .query("faAuctionCycles")
        .withIndex("by_season_status", (q) =>
          q.eq("seasonId", settings.seasonId).eq("status", "open"),
        )
        .collect();

      let weeklyStillOpen = false;
      for (const cycle of openCycles) {
        if (cycle.closesAt > now) {
          if ((cycle.type ?? "weekly") === "weekly") weeklyStillOpen = true;
          continue;
        }
        // Expired but still "open" - the scheduler missed it. Close it now.
        await closeCycleHandler(ctx, cycle._id);
      }

      if (weeklyStillOpen) continue;

      const closesAt = nextWeeklyOccurrence(
        now,
        settings.closeWeekday,
        settings.closeHour,
        settings.closeMinute,
        settings.timeZone,
      );
      const cycleId = await ctx.db.insert("faAuctionCycles", {
        seasonId: settings.seasonId,
        type: "weekly",
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

// One-off migration: backfill `type: "weekly"` onto every faAuctionCycles
// row that predates the field (every row that existed before this feature -
// "weekly" was the only kind of cycle back then). Run once via `npx convex
// run infinileague/auction/cycles:backfillCycleTypes` after deploying the
// schema change, before tightening `type` to required in a follow-up
// deploy. Safe to re-run - a no-op once every row has a type.
export const backfillCycleTypes = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ patched: number }> => {
    const cycles = await ctx.db.query("faAuctionCycles").collect();
    let patched = 0;
    for (const cycle of cycles) {
      if (cycle.type === undefined) {
        await ctx.db.patch(cycle._id, { type: "weekly" });
        patched++;
      }
    }
    return { patched };
  },
});

// Shared by startManualAuctionCycle (mechanism 3) and sleeper/
// transactions.ts's detectSleeperDrops (mechanism 2) - creates a cycle
// scoped to a fixed, explicit set of fpids and locks each one via
// faAuctionFpidCycles so it's excluded from the weekly pool and rejected by
// any other attempt to scope it into a second cycle. Callers must have
// already validated every fpid is unrostered and not already locked -
// this only re-asserts the lock check transactionally (the actual race
// guard), it does not re-check roster status.
export async function openDedicatedCycleHandler(
  ctx: MutationCtx,
  args: {
    seasonId: Id<"seasons">;
    type: "playerDrop" | "manual";
    fpids: number[];
    durationMs: number;
  },
): Promise<Id<"faAuctionCycles">> {
  for (const fpid of args.fpids) {
    const existingLock = await ctx.db
      .query("faAuctionFpidCycles")
      .withIndex("by_season_fpid", (q) =>
        q.eq("seasonId", args.seasonId).eq("fpid", fpid),
      )
      .unique();
    if (existingLock) {
      throw new Error(
        `Player #${fpid} is already part of another open bid cycle.`,
      );
    }
  }

  const now = Date.now();
  const closesAt = now + args.durationMs;
  const cycleId = await ctx.db.insert("faAuctionCycles", {
    seasonId: args.seasonId,
    type: args.type,
    opensAt: now,
    closesAt,
    status: "open",
  });
  for (const fpid of args.fpids) {
    await ctx.db.insert("faAuctionFpidCycles", {
      seasonId: args.seasonId,
      fpid,
      cycleId,
    });
  }
  const jobId = await ctx.scheduler.runAt(
    closesAt,
    internal.infinileague.auction.cycles.closeCycle,
    { cycleId },
  );
  await ctx.db.patch(cycleId, { closeJobId: jobId });
  return cycleId;
}

// Commissioner-only manual override, mainly for testing: opens a WEEKLY
// cycle right now instead of waiting for the next scheduled closeWeekday/
// closeHour, with a commissioner-chosen duration rather than the real
// weekly schedule. Independent of faAuctionSettings.enabled - a
// commissioner should be able to spin up a one-off test window without
// first turning on the recurring weekly cron behavior that flag gates.
// Distinct from startManualAuctionCycle below (mechanism 3), which scopes a
// dedicated cycle to specific players rather than opening the weekly one -
// only ONE open weekly cycle is ever allowed per season, but it can coexist
// with any number of open dedicated cycles.
export const openAuctionCycleNow = mutation({
  args: { seasonId: v.id("seasons"), durationMinutes: v.number() },
  handler: async (ctx, args): Promise<Id<"faAuctionCycles">> => {
    await requireSeasonOwner(ctx, args.seasonId);
    if (!Number.isFinite(args.durationMinutes) || args.durationMinutes <= 0) {
      throw new Error("Duration must be a positive number of minutes.");
    }

    const existingOpen = await ctx.db
      .query("faAuctionCycles")
      .withIndex("by_season_type_status", (q) =>
        q.eq("seasonId", args.seasonId).eq("type", "weekly").eq("status", "open"),
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
      type: "weekly",
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

// Commissioner-only manual override: closes a cycle immediately rather than
// waiting for closesAt. With no `cycleId`, targets the open weekly cycle
// (today's only caller, the Players tab's "Close now" button, never passes
// one). A `cycleId` targets a specific dedicated cycle instead - for a
// future commissioner UI that wants to end a playerDrop/manual cycle early
// without touching the weekly one.
export const closeAuctionCycleNow = mutation({
  args: { seasonId: v.id("seasons"), cycleId: v.optional(v.id("faAuctionCycles")) },
  handler: async (ctx, args): Promise<void> => {
    await requireSeasonOwner(ctx, args.seasonId);

    let cycle: Doc<"faAuctionCycles"> | null;
    if (args.cycleId) {
      cycle = await ctx.db.get(args.cycleId);
      if (!cycle || cycle.seasonId !== args.seasonId || cycle.status !== "open") {
        throw new Error("That cycle isn't currently open.");
      }
    } else {
      cycle = await ctx.db
        .query("faAuctionCycles")
        .withIndex("by_season_type_status", (q) =>
          q.eq("seasonId", args.seasonId).eq("type", "weekly").eq("status", "open"),
        )
        .first();
      if (!cycle) {
        throw new Error("There's no open auction cycle to close.");
      }
    }

    if (cycle.closeJobId) {
      await ctx.scheduler.cancel(cycle.closeJobId);
    }
    await closeCycleHandler(ctx, cycle._id);
  },
});

// Commissioner-only (mechanism 3): hand-pick one or more currently-
// unrostered, not-already-locked players and start a dedicated bid cycle
// for them, for a custom duration - bid parameters (minIncrement/
// startingBid/tieBreakMode) reuse the season's existing faAuctionSettings,
// same as any other cycle (see bids.ts's placeBid, which doesn't
// distinguish cycle type when reading those). Sleeper-only: Yahoo's own
// status=W poll is the sole eligibility signal there, with no concept of a
// commissioner-started dedicated window.
export const startManualAuctionCycle = mutation({
  args: {
    seasonId: v.id("seasons"),
    fpids: v.array(v.number()),
    durationMinutes: v.number(),
  },
  handler: async (ctx, args): Promise<Id<"faAuctionCycles">> => {
    const { season } = await requireSeasonOwner(ctx, args.seasonId);
    if (season.sleeperLeagueId === undefined) {
      throw new Error("Manual bid cycles are only available for Sleeper-linked seasons.");
    }
    if (args.fpids.length === 0) {
      throw new Error("Select at least one player.");
    }
    if (!Number.isFinite(args.durationMinutes) || args.durationMinutes <= 0) {
      throw new Error("Duration must be a positive number of minutes.");
    }

    const rosteredRows = await ctx.db
      .query("rosterPlayers")
      .withIndex("by_season", (q) => q.eq("seasonId", args.seasonId))
      .collect();
    const rosteredFpids = new Set(rosteredRows.map((r) => r.fpid));
    const rosteredSelected = args.fpids.filter((fpid) => rosteredFpids.has(fpid));
    if (rosteredSelected.length > 0) {
      throw new Error(
        `These players are currently rostered, not free agents: ${rosteredSelected.join(", ")}.`,
      );
    }

    return await openDedicatedCycleHandler(ctx, {
      seasonId: args.seasonId,
      type: "manual",
      fpids: args.fpids,
      durationMs: args.durationMinutes * 60 * 1000,
    });
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
