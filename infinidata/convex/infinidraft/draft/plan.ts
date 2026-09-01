import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import { requireDraftOwner } from "../../lib/access";

export const getBudgetPlan = query({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args) => {
    const { draft } = await requireDraftOwner(ctx, args.seasonId);
    return await ctx.db
      .query("draftBudgetPlans")
      .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
      .first();
  },
});

// The effective in-draft budget: the pre-draft plan with any live overrides
// laid on top, merged server-side so every consumer (matchPlanSlot via
// usePlanSlots/useTeamBudget, MyTeamTab) reads one already-merged shape
// instead of re-deriving the same merge in multiple places. `overriddenKeys`
// lets the live Budget tab distinguish "mirroring pre-draft" slots from
// ones the user has actually touched this draft (for highlighting / the
// per-slot reset control). Null when neither a pre-draft plan nor any live
// overrides exist yet - nothing to show.
export const getLiveBudgetPlan = query({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args) => {
    const { draft } = await requireDraftOwner(ctx, args.seasonId);
    const plan = await ctx.db
      .query("draftBudgetPlans")
      .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
      .first();
    const live = await ctx.db
      .query("draftLiveBudgetOverrides")
      .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
      .first();
    if (!plan && !live) return null;
    return {
      amounts: { ...(plan?.amounts ?? {}), ...(live?.overrides ?? {}) },
      overspendBehavior:
        live?.overspendBehavior ?? plan?.overspendBehavior ?? "bench",
      overriddenKeys: Object.keys(live?.overrides ?? {}),
    };
  },
});

// Preset formulas (Stars & Scrubs, Balanced, Zero RB, Superflex Heavy) are
// pure client-side functions that populate the Budget tab's form before
// Save - this is the only write path, called once the user confirms
// whatever amounts are showing.
export const upsertBudgetPlan = mutation({
  args: {
    seasonId: v.id("seasons"),
    amounts: v.record(v.string(), v.number()),
    overspendBehavior: v.union(
      v.literal("bench"),
      v.literal("spread"),
      v.literal("ask"),
    ),
  },
  handler: async (ctx, args) => {
    const { draft } = await requireDraftOwner(ctx, args.seasonId);
    const existing = await ctx.db
      .query("draftBudgetPlans")
      .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
      .first();
    const fields = {
      amounts: args.amounts,
      overspendBehavior: args.overspendBehavior,
      updatedAt: Date.now(),
    };
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return existing._id;
    }
    return await ctx.db.insert("draftBudgetPlans", {
      draftId: draft._id,
      ...fields,
    });
  },
});

// Called from the Draft Room's Budget tab (live mode) - `overrides` is the
// FULL set of slot keys the user has touched so far this draft (not just
// the one they just changed), since the live editor tracks that set in its
// own local state and always writes the complete picture back. Any slot key
// not present here keeps mirroring draftBudgetPlans.amounts.
export const upsertLiveBudgetOverrides = mutation({
  args: {
    seasonId: v.id("seasons"),
    overrides: v.record(v.string(), v.number()),
    overspendBehavior: v.optional(
      v.union(v.literal("bench"), v.literal("spread"), v.literal("ask")),
    ),
  },
  handler: async (ctx, args) => {
    const { draft } = await requireDraftOwner(ctx, args.seasonId);
    const existing = await ctx.db
      .query("draftLiveBudgetOverrides")
      .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
      .first();
    const fields = {
      overrides: args.overrides,
      ...(args.overspendBehavior !== undefined
        ? { overspendBehavior: args.overspendBehavior }
        : {}),
      updatedAt: Date.now(),
    };
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return existing._id;
    }
    return await ctx.db.insert("draftLiveBudgetOverrides", {
      draftId: draft._id,
      ...fields,
    });
  },
});

// "Reset to pre-draft plan" - drops every live override so the in-draft
// budget goes back to fully mirroring draftBudgetPlans.
export const resetLiveBudgetPlan = mutation({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args) => {
    const { draft } = await requireDraftOwner(ctx, args.seasonId);
    const existing = await ctx.db
      .query("draftLiveBudgetOverrides")
      .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});
