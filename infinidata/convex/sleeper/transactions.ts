import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { fetchCurrentNflWeek } from "./state";
import { getCurrentWeekKickoffByFpid } from "../infinileague/auction/eligibility";
import { openDedicatedCycleHandler } from "../infinileague/auction/cycles";

/**
 * Mechanism 2 of infinifaab's Sleeper bid-eligibility (see the "Multi-cycle
 * Sleeper waiver eligibility" plan this shipped from): detects Sleeper drop
 * transactions and opens a dedicated bid cycle scoped to just that player,
 * for a commissioner-configurable duration (faAuctionSettings.
 * dropCycleDurationHours, default 48h) - unless that player's own current-
 * week game kicks off before that window would end, in which case the
 * always-open weekly cycle (eligibility.ts's rule 1) will pick them up on
 * its own once kickoff passes, so no dedicated cycle is needed.
 *
 * Replaces an earlier, now-abandoned approach that lived in this file
 * (computing a derived waiverPlayers.clearsAt from drop transactions) - real-
 * world testing showed that approach massively undercounted the real
 * waiver pool (see eligibility.ts's header comment for the full story) and
 * was never wired into eligibility as a result. This file now polls the
 * same Sleeper transactions endpoint for a different purpose: not computing
 * "when does this player clear", but detecting the drop EVENT itself.
 */

const DEFAULT_DROP_CYCLE_HOURS = 48;

interface SleeperTransaction {
  transaction_id: string;
  status: string;
  drops: Record<string, string> | null;
}

async function fetchSleeperTransactionsForRound(
  sleeperLeagueId: string,
  round: string,
): Promise<SleeperTransaction[]> {
  const response = await fetch(
    `https://api.sleeper.app/v1/league/${sleeperLeagueId}/transactions/${round}`,
  );
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Sleeper transactions request failed: ${response.status} ${response.statusText}` +
        (body ? ` - ${body}` : ""),
    );
  }
  return await response.json();
}

// No auth check - only ever called from our own cron-triggered orchestrator
// below, never exposed publicly. Same "cron has no signed-in user" reasoning
// as fetchAllData.ts's fetchAllInternal split.
export const getSeasonAndSettingsForDropDetection = internalQuery({
  args: { seasonId: v.id("seasons") },
  handler: async (
    ctx,
    args,
  ): Promise<{ season: Doc<"seasons">; settings: Doc<"faAuctionSettings"> | null } | null> => {
    const season = await ctx.db.get(args.seasonId);
    if (!season) return null;
    const settings = await ctx.db
      .query("faAuctionSettings")
      .withIndex("by_season", (q) => q.eq("seasonId", args.seasonId))
      .unique();
    return { season, settings };
  },
});

interface DropCandidate {
  fpid: number;
  transactionId: string;
}

// Every completed drop from the current + previous transaction round that
// hasn't already been logged in faAuctionProcessedDrops - the idempotency
// gate that keeps a 20-min poll re-fetching overlapping rounds from
// reprocessing the same real-world drop over and over.
export const getUnprocessedDrops = internalQuery({
  args: { seasonId: v.id("seasons"), candidates: v.array(
    v.object({ fpid: v.number(), transactionId: v.string() }),
  ) },
  handler: async (ctx, args): Promise<DropCandidate[]> => {
    const unprocessed: DropCandidate[] = [];
    for (const candidate of args.candidates) {
      const existing = await ctx.db
        .query("faAuctionProcessedDrops")
        .withIndex("by_season_txn_fpid", (q) =>
          q
            .eq("seasonId", args.seasonId)
            .eq("sleeperTransactionId", candidate.transactionId)
            .eq("fpid", candidate.fpid),
        )
        .unique();
      if (!existing) unprocessed.push(candidate);
    }
    return unprocessed;
  },
});

// Everything one drop candidate needs to decide its outcome, resolved in a
// single query so the internalAction orchestrator below stays a thin loop.
// dropCycleDurationHours is resolved once by the caller (not re-read per
// fpid) - see detectSleeperDrops.
export const getDropDetectionContext = internalQuery({
  args: { seasonId: v.id("seasons"), fpid: v.number() },
  handler: async (
    ctx,
    args,
  ): Promise<{
    isRostered: boolean;
    isLocked: boolean;
    kickoffAt: number | undefined;
  } | null> => {
    const season = await ctx.db.get(args.seasonId);
    if (!season) return null;

    const [rosteredRow, lockRow, kickoffByFpid] = await Promise.all([
      ctx.db
        .query("rosterPlayers")
        .withIndex("by_season", (q) => q.eq("seasonId", args.seasonId))
        .filter((q) => q.eq(q.field("fpid"), args.fpid))
        .first(),
      ctx.db
        .query("faAuctionFpidCycles")
        .withIndex("by_season_fpid", (q) =>
          q.eq("seasonId", args.seasonId).eq("fpid", args.fpid),
        )
        .unique(),
      getCurrentWeekKickoffByFpid(ctx, season),
    ]);

    return {
      isRostered: rosteredRow !== null,
      isLocked: lockRow !== null,
      kickoffAt: kickoffByFpid.get(args.fpid),
    };
  },
});

export const recordProcessedDrop = internalMutation({
  args: {
    seasonId: v.id("seasons"),
    sleeperTransactionId: v.string(),
    fpid: v.number(),
    outcome: v.union(
      v.literal("cycleCreated"),
      v.literal("foldedIntoWeekly"),
      v.literal("skippedAlreadyCovered"),
      v.literal("skippedRerostered"),
    ),
    cycleId: v.optional(v.id("faAuctionCycles")),
  },
  handler: async (ctx, args): Promise<void> => {
    await ctx.db.insert("faAuctionProcessedDrops", {
      seasonId: args.seasonId,
      sleeperTransactionId: args.sleeperTransactionId,
      fpid: args.fpid,
      processedAt: Date.now(),
      outcome: args.outcome,
      ...(args.cycleId !== undefined ? { cycleId: args.cycleId } : {}),
    });
  },
});

// Opens a dedicated "playerDrop" cycle for a single fpid - a thin mutation
// wrapper around cycles.ts's shared openDedicatedCycleHandler (also used by
// startManualAuctionCycle for mechanism 3) plus the processed-drop log
// write, both inside one transaction so a crash between the two can never
// happen.
export const openPlayerDropCycle = internalMutation({
  args: {
    seasonId: v.id("seasons"),
    fpid: v.number(),
    durationMs: v.number(),
    sleeperTransactionId: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"faAuctionCycles"> | null> => {
    // Re-check the lock right before creating - a concurrent event (another
    // drop of the same player re-processed out of order, a manual cycle)
    // could have claimed it since getDropDetectionContext read it.
    const existingLock = await ctx.db
      .query("faAuctionFpidCycles")
      .withIndex("by_season_fpid", (q) =>
        q.eq("seasonId", args.seasonId).eq("fpid", args.fpid),
      )
      .unique();
    if (existingLock) {
      await ctx.db.insert("faAuctionProcessedDrops", {
        seasonId: args.seasonId,
        sleeperTransactionId: args.sleeperTransactionId,
        fpid: args.fpid,
        processedAt: Date.now(),
        outcome: "skippedAlreadyCovered",
      });
      return null;
    }

    const cycleId = await openDedicatedCycleHandler(ctx, {
      seasonId: args.seasonId,
      type: "playerDrop",
      fpids: [args.fpid],
      durationMs: args.durationMs,
    });
    await ctx.db.insert("faAuctionProcessedDrops", {
      seasonId: args.seasonId,
      sleeperTransactionId: args.sleeperTransactionId,
      fpid: args.fpid,
      processedAt: Date.now(),
      outcome: "cycleCreated",
      cycleId,
    });
    return cycleId;
  },
});

// Per-season drop detection - see this file's header comment for the full
// control flow. Bails immediately for a non-Sleeper or auction-disabled
// season (mirrors waiverSync.ts's own season-filtering pattern).
export const detectSleeperDrops = internalAction({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args): Promise<{ processed: number }> => {
    const seasonAndSettings = await ctx.runQuery(
      internal.sleeper.transactions.getSeasonAndSettingsForDropDetection,
      { seasonId: args.seasonId },
    );
    if (!seasonAndSettings) return { processed: 0 };
    const { season, settings } = seasonAndSettings;
    if (!season.sleeperLeagueId || !settings?.enabled) return { processed: 0 };
    const dropCycleDurationHours = settings.dropCycleDurationHours ?? DEFAULT_DROP_CYCLE_HOURS;

    const week = await fetchCurrentNflWeek();
    // "0" is the offseason/draft-prep sentinel (see fetchAllData.ts) - no
    // real transactions round to check. Otherwise check this week's round
    // and last week's, since a drop late last week could still be within
    // its 48h-ish window now.
    const rounds =
      week === "0"
        ? []
        : [...new Set([week, String(Math.max(1, Number(week) - 1))])];

    const candidatesByKey = new Map<string, DropCandidate>();
    for (const round of rounds) {
      const transactions = await fetchSleeperTransactionsForRound(
        season.sleeperLeagueId,
        round,
      );
      for (const txn of transactions) {
        if (txn.status !== "complete" || !txn.drops) continue;
        for (const playerId of Object.keys(txn.drops)) {
          // fpid IS Sleeper's numeric player_id in this app (see
          // convex/sleeper/playerLinks.ts) - DST rows use a team
          // abbreviation as their Sleeper id instead, which Number()
          // correctly rejects here (waivers on defenses aren't modeled).
          const fpid = Number(playerId);
          if (!Number.isFinite(fpid)) continue;
          candidatesByKey.set(`${txn.transaction_id}:${fpid}`, {
            fpid,
            transactionId: txn.transaction_id,
          });
        }
      }
    }
    if (candidatesByKey.size === 0) return { processed: 0 };

    const unprocessed = await ctx.runQuery(
      internal.sleeper.transactions.getUnprocessedDrops,
      { seasonId: args.seasonId, candidates: [...candidatesByKey.values()] },
    );

    let processed = 0;
    for (const drop of unprocessed) {
      const context = await ctx.runQuery(
        internal.sleeper.transactions.getDropDetectionContext,
        { seasonId: args.seasonId, fpid: drop.fpid },
      );
      if (!context) continue;

      if (context.isRostered) {
        await ctx.runMutation(internal.sleeper.transactions.recordProcessedDrop, {
          seasonId: args.seasonId,
          sleeperTransactionId: drop.transactionId,
          fpid: drop.fpid,
          outcome: "skippedRerostered",
        });
        processed++;
        continue;
      }
      if (context.isLocked) {
        await ctx.runMutation(internal.sleeper.transactions.recordProcessedDrop, {
          seasonId: args.seasonId,
          sleeperTransactionId: drop.transactionId,
          fpid: drop.fpid,
          outcome: "skippedAlreadyCovered",
        });
        processed++;
        continue;
      }

      const durationMs = dropCycleDurationHours * 60 * 60 * 1000;
      const wouldCloseAt = Date.now() + durationMs;
      if (context.kickoffAt !== undefined && context.kickoffAt <= wouldCloseAt) {
        // The always-open weekly cycle will pick this player up on its own
        // once kickoff passes (eligibility.ts's rule 1) - a dedicated cycle
        // would just be a redundant parallel window.
        await ctx.runMutation(internal.sleeper.transactions.recordProcessedDrop, {
          seasonId: args.seasonId,
          sleeperTransactionId: drop.transactionId,
          fpid: drop.fpid,
          outcome: "foldedIntoWeekly",
        });
        processed++;
        continue;
      }

      await ctx.runMutation(internal.sleeper.transactions.openPlayerDropCycle, {
        seasonId: args.seasonId,
        fpid: drop.fpid,
        durationMs,
        sleeperTransactionId: drop.transactionId,
      });
      processed++;
    }

    return { processed };
  },
});

// Cron-driven (see convex/crons.ts) - kept as its own separate cron entry
// rather than folded into waiverSync.ts's refreshAllSeasons, which is
// Yahoo-only by design (see that file's own comment); blurring that
// boundary would make both files harder to reason about. Best-effort per
// season: one league's hiccup (Sleeper rate limit, Tank01 API issue) can't
// block every other league's drop detection in the same cron tick.
export const detectSleeperDropsAllSeasons = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const seasons = await ctx.runQuery(
      internal.infinileague.auction.waiverSync.listEnabledAuctionSeasons,
      {},
    );
    for (const season of seasons) {
      if (!season.sleeperLeagueId) continue;
      try {
        await ctx.runAction(internal.sleeper.transactions.detectSleeperDrops, {
          seasonId: season._id,
        });
      } catch (err) {
        console.error(`Sleeper drop detection failed for season ${season._id}:`, err);
      }
    }
  },
});
