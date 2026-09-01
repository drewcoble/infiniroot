import { v } from "convex/values";
import { internalMutation, mutation } from "../../_generated/server";
import { requireDraftOwner } from "../../lib/access";
import { syncDraftStatus } from "./status";

// The one deliberate "begin the live auction" action - previously the app
// had no such moment at all (drafts.status was purely derived from pick
// count, so adding a keeper pre-draft silently looked like the auction had
// started). Locks league configuration (see requireDraftNotStarted's
// callers) and unblocks nomination (requireDraftStarted's callers).
export const startDraft = mutation({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args) => {
    const { season, draft } = await requireDraftOwner(ctx, args.seasonId);
    if (draft.startedAt !== undefined) {
      throw new Error("This draft has already started.");
    }
    const teams = await ctx.db
      .query("seasonTeams")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .first();
    if (!teams) {
      throw new Error("Add at least one team before starting the draft.");
    }
    await ctx.db.patch(draft._id, { startedAt: Date.now() });
    await syncDraftStatus(ctx, draft._id);
    return null;
  },
});

// Reverses startDraft - only while nothing has actually been drafted yet
// (keepers don't count, since those are meant to be added pre-draft). Once
// a real pick exists, the auction has genuinely begun and there's no way
// back to "pre_draft" other than undoing picks first (undoLastPick).
export const reopenPreDraft = mutation({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args) => {
    const { draft } = await requireDraftOwner(ctx, args.seasonId);
    if (draft.startedAt === undefined) {
      throw new Error("This draft hasn't been started.");
    }
    const picks = await ctx.db
      .query("draftPicks")
      .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
      .collect();
    if (picks.some((pick) => !pick.isKeeper)) {
      throw new Error(
        "Players have already been drafted - undo those picks before reopening pre-draft.",
      );
    }
    await ctx.db.patch(draft._id, { startedAt: undefined });
    await syncDraftStatus(ctx, draft._id);
    return null;
  },
});

// System-triggered counterpart to startDraft above - no requireDraftOwner
// check, since this is only ever called by convex/sleeper/draftSync.ts's
// scheduled poller (which already verified ownership once, at link time in
// linkSleeperDraft), never directly by a client. Auto-flips the draft into
// "started" close to the linked Sleeper draft's scheduled start_time so the
// host doesn't have to remember to click "Start Draft" themselves. A no-op
// if the draft is already started (the poller may call this more than once
// near the start window).
export const startDraftForSyncInternal = internalMutation({
  args: { draftId: v.id("drafts") },
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft || draft.startedAt !== undefined) return null;
    await ctx.db.patch(args.draftId, { startedAt: Date.now() });
    await syncDraftStatus(ctx, args.draftId);
    return null;
  },
});
