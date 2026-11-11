import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { requireSeasonViewer } from "../lib/access";
import type { PlayoffFormat } from "../lib/playoffRules/format";
import { formatProblem } from "../lib/playoffRules/validate";

export interface PlayoffRules {
  // Null = the platform's own playoffs.
  format: PlayoffFormat | null;
  updatedAt: number | null;
  // Every matchup draft so far (team ids are seasonTeams ids).
  drafts: Doc<"playoffDrafts">[];
}

// The league's format and drafts - a live query, so a rules edit or a
// draft pick shows up for everyone at once.
export const getRules = query({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args): Promise<PlayoffRules> => {
    await requireSeasonViewer(ctx, args.seasonId);
    const [settings, drafts] = await Promise.all([
      ctx.db
        .query("playoffSettings")
        .withIndex("by_season", (q) => q.eq("seasonId", args.seasonId))
        .unique(),
      ctx.db
        .query("playoffDrafts")
        .withIndex("by_season_stage", (q) => q.eq("seasonId", args.seasonId))
        .collect(),
    ]);
    return {
      format: (settings?.format as PlayoffFormat | undefined) ?? null,
      updatedAt: settings?.formatUpdatedAt ?? null,
      drafts,
    };
  },
});

// Commissioner only. Null goes back to the platform's playoffs. A changed
// format discards any draft already under way, since its drafters, weeks
// or pool may no longer hold.
export const setFormat = mutation({
  args: { seasonId: v.id("seasons"), format: v.union(v.any(), v.null()) },
  handler: async (ctx, args): Promise<void> => {
    const { season, isCommissioner } = await requireSeasonViewer(ctx, args.seasonId);
    if (!isCommissioner) throw new Error("Only the commissioner can change the playoff rules.");
    const format = args.format as PlayoffFormat | null;
    if (format) {
      const problem = formatProblem(format, season.teamCount);
      if (problem) throw new Error(problem);
    }
    const settings = await ctx.db
      .query("playoffSettings")
      .withIndex("by_season", (q) => q.eq("seasonId", args.seasonId))
      .unique();
    const patch = { format: format ?? undefined, formatUpdatedAt: Date.now() };
    if (settings) await ctx.db.patch(settings._id, patch);
    else await ctx.db.insert("playoffSettings", { seasonId: args.seasonId, ...patch });

    const drafts = await ctx.db
      .query("playoffDrafts")
      .withIndex("by_season_stage", (q) => q.eq("seasonId", args.seasonId))
      .collect();
    for (const draft of drafts) await ctx.db.delete(draft._id);
  },
});
