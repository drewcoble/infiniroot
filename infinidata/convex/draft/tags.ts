import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { requireDraftOwner } from "./auth";

export const listPlayerTags = query({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args) => {
    const { draft } = await requireDraftOwner(ctx, args.seasonId);
    return await ctx.db
      .query("draftPlayerTags")
      .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
      .collect();
  },
});

// Single write path for the bar-click interaction: cycles a player through
// no-opinion -> target -> avoid -> no-opinion, so the frontend never has to
// know the current state to decide what to write next.
export const cyclePlayerTag = mutation({
  args: { seasonId: v.id("seasons"), fpid: v.number() },
  handler: async (ctx, args) => {
    const { draft } = await requireDraftOwner(ctx, args.seasonId);
    const existing = await ctx.db
      .query("draftPlayerTags")
      .withIndex("by_draft_fpid", (q) =>
        q.eq("draftId", draft._id).eq("fpid", args.fpid),
      )
      .first();

    if (!existing) {
      // New targets append to the end of the Shortlist tab's order - read
      // every tag for this draft (same bounded per-draft read listPlayerTags
      // already does) just to find the current max order among targets.
      const allTags = await ctx.db
        .query("draftPlayerTags")
        .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
        .collect();
      const maxOrder = allTags
        .filter((tag) => tag.tag === "target")
        .reduce((max, tag) => Math.max(max, tag.order ?? -1), -1);
      return await ctx.db.insert("draftPlayerTags", {
        draftId: draft._id,
        fpid: args.fpid,
        tag: "target",
        order: maxOrder + 1,
        updatedAt: Date.now(),
      });
    }
    if (existing.tag === "target") {
      await ctx.db.patch(existing._id, { tag: "avoid", updatedAt: Date.now() });
      return existing._id;
    }
    await ctx.db.delete(existing._id);
    return null;
  },
});

// Direct one-step set (not a cycle) - used by explicit Target/Avoid buttons
// (e.g. the Players Left board's per-player popover) where the two actions
// are separate controls rather than one button to step through. Setting the
// tag a row already has clears it instead (so clicking an already-active
// button toggles it off) rather than being a no-op.
export const setPlayerTag = mutation({
  args: {
    seasonId: v.id("seasons"),
    fpid: v.number(),
    tag: v.union(v.literal("target"), v.literal("avoid")),
  },
  handler: async (ctx, args) => {
    const { draft } = await requireDraftOwner(ctx, args.seasonId);
    const existing = await ctx.db
      .query("draftPlayerTags")
      .withIndex("by_draft_fpid", (q) =>
        q.eq("draftId", draft._id).eq("fpid", args.fpid),
      )
      .first();

    if (existing && existing.tag === args.tag) {
      await ctx.db.delete(existing._id);
      return null;
    }
    if (existing) {
      await ctx.db.patch(existing._id, { tag: args.tag, updatedAt: Date.now() });
      return existing._id;
    }

    // Same append-to-end-of-shortlist ordering as cyclePlayerTag above -
    // only meaningful for "target", "avoid" rows don't use `order`.
    let order: number | undefined;
    if (args.tag === "target") {
      const allTags = await ctx.db
        .query("draftPlayerTags")
        .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
        .collect();
      order =
        allTags
          .filter((t) => t.tag === "target")
          .reduce((max, t) => Math.max(max, t.order ?? -1), -1) + 1;
    }
    return await ctx.db.insert("draftPlayerTags", {
      draftId: draft._id,
      fpid: args.fpid,
      tag: args.tag,
      ...(order !== undefined ? { order } : {}),
      updatedAt: Date.now(),
    });
  },
});

// Direct one-step removal (any tag -> no-opinion) - used by the Shortlist
// tab's "Remove" action, where stepping through cyclePlayerTag's
// target -> avoid -> gone sequence would leave a target briefly (and
// confusingly) marked avoid instead of just disappearing from the list.
export const clearPlayerTag = mutation({
  args: { seasonId: v.id("seasons"), fpid: v.number() },
  handler: async (ctx, args) => {
    const { draft } = await requireDraftOwner(ctx, args.seasonId);
    const existing = await ctx.db
      .query("draftPlayerTags")
      .withIndex("by_draft_fpid", (q) =>
        q.eq("draftId", draft._id).eq("fpid", args.fpid),
      )
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
    return null;
  },
});

// Rewrites the shortlist's display order to match `fpids` - the full,
// reordered list of every currently-"target"-tagged player's fpid, sent as
// one array from the Shortlist tab's up/down controls rather than a
// single-item move, since order is a dense 0..n-1 sequence over the whole
// list, not a per-row property that can be nudged in isolation. Rows whose
// order is already correct are left untouched, so a one-step swap only ever
// writes the two rows that actually moved.
export const reorderShortlist = mutation({
  args: {
    seasonId: v.id("seasons"),
    fpids: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    const { draft } = await requireDraftOwner(ctx, args.seasonId);
    for (let i = 0; i < args.fpids.length; i++) {
      const tag = await ctx.db
        .query("draftPlayerTags")
        .withIndex("by_draft_fpid", (q) =>
          q.eq("draftId", draft._id).eq("fpid", args.fpids[i]!),
        )
        .first();
      if (tag && tag.tag === "target" && tag.order !== i) {
        await ctx.db.patch(tag._id, { order: i, updatedAt: Date.now() });
      }
    }
    return null;
  },
});
