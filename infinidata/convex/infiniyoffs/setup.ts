import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { PlayoffFormat } from "../lib/playoffRules/format";
import { requireSeasonOwner } from "../lib/access";
import { applyFormat } from "./rules";

// infiniyoffs' setup flow, step by step (infiniyoffs/src/routes/league/
// $leagueId/setup.tsx). The choices so far are a draft on the league's
// playoffSettings row - nothing changes for the league until Review saves
// them with finishSetup.

// The draft's shape is the client's (SetupDraft in infiniyoffs' lib/
// setupFlow.ts) - stored as-is, read back only by that page.
export const getSetupDraft = query({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args): Promise<unknown> => {
    await requireSeasonOwner(ctx, args.seasonId);
    const settings = await ctx.db
      .query("playoffSettings")
      .withIndex("by_season", (q) => q.eq("seasonId", args.seasonId))
      .unique();
    return settings?.setupDraft ?? null;
  },
});

export const saveSetupDraft = mutation({
  args: { seasonId: v.id("seasons"), draft: v.any() },
  handler: async (ctx, args): Promise<void> => {
    await requireSeasonOwner(ctx, args.seasonId);
    const settings = await ctx.db
      .query("playoffSettings")
      .withIndex("by_season", (q) => q.eq("seasonId", args.seasonId))
      .unique();
    if (settings) await ctx.db.patch(settings._id, { setupDraft: args.draft });
    else {
      await ctx.db.insert("playoffSettings", { seasonId: args.seasonId, setupDraft: args.draft });
    }
  },
});

// Review's save: the rules, then setup's done and its draft cleared.
export const finishSetup = mutation({
  args: { seasonId: v.id("seasons"), format: v.union(v.any(), v.null()) },
  handler: async (ctx, args): Promise<void> => {
    const { season } = await requireSeasonOwner(ctx, args.seasonId);
    await applyFormat(ctx, season, args.format as PlayoffFormat | null);
    const settings = await ctx.db
      .query("playoffSettings")
      .withIndex("by_season", (q) => q.eq("seasonId", args.seasonId))
      .unique();
    const done = { setupDraft: undefined, setupCompletedAt: Date.now(), inYoffs: true };
    if (settings) await ctx.db.patch(settings._id, done);
    else await ctx.db.insert("playoffSettings", { seasonId: args.seasonId, ...done });
  },
});
