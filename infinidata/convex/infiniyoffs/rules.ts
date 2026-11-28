import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { requireSeasonViewer } from "../lib/access";
import { keepsDraft, keepsManualGroups, sameFormat } from "../lib/playoffRules/carryOver";
import type { ManualGroups, PlayoffFormat } from "../lib/playoffRules/format";
import { formatProblem, manualGroupsProblem } from "../lib/playoffRules/validate";

export interface PlayoffRules {
  // Null = the platform's own playoffs.
  format: PlayoffFormat | null;
  updatedAt: number | null;
  // Every matchup draft so far (team ids are seasonTeams ids).
  drafts: Doc<"playoffDrafts">[];
  // Group stages the commissioner set by hand.
  manualGroups: Doc<"playoffManualGroups">[];
}

// The league's format and drafts - a live query, so a rules edit or a
// draft pick shows up for everyone at once.
export const getRules = query({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args): Promise<PlayoffRules> => {
    await requireSeasonViewer(ctx, args.seasonId);
    const [settings, drafts, manualGroups] = await Promise.all([
      ctx.db
        .query("playoffSettings")
        .withIndex("by_season", (q) => q.eq("seasonId", args.seasonId))
        .unique(),
      ctx.db
        .query("playoffDrafts")
        .withIndex("by_season_stage", (q) => q.eq("seasonId", args.seasonId))
        .collect(),
      ctx.db
        .query("playoffManualGroups")
        .withIndex("by_season_stage", (q) => q.eq("seasonId", args.seasonId))
        .collect(),
    ]);
    return {
      format: (settings?.format as PlayoffFormat | undefined) ?? null,
      updatedAt: settings?.formatUpdatedAt ?? null,
      drafts,
      manualGroups,
    };
  },
});

// Saves the league's format. Null goes back to the platform's playoffs.
// Saving the same format changes nothing; otherwise a draft under way or
// hand-set groups are discarded only when the change moves their group
// stage (see lib/playoffRules/carryOver.ts). The caller checks the
// commissioner.
export async function applyFormat(
  ctx: MutationCtx,
  season: Doc<"seasons">,
  format: PlayoffFormat | null,
): Promise<void> {
  if (format) {
    const problem = formatProblem(format, season.teamCount);
    if (problem) throw new Error(problem);
  }
  const settings = await ctx.db
    .query("playoffSettings")
    .withIndex("by_season", (q) => q.eq("seasonId", season._id))
    .unique();
  const prev = (settings?.format as PlayoffFormat | undefined) ?? null;
  if (sameFormat(prev, format)) return;
  const patch = { format: format ?? undefined, formatUpdatedAt: Date.now() };
  if (settings) await ctx.db.patch(settings._id, patch);
  else await ctx.db.insert("playoffSettings", { seasonId: season._id, ...patch });

  const drafts = await ctx.db
    .query("playoffDrafts")
    .withIndex("by_season_stage", (q) => q.eq("seasonId", season._id))
    .collect();
  for (const draft of drafts) {
    if (!keepsDraft(prev, format, draft.stageId)) await ctx.db.delete(draft._id);
  }
  const manualGroups = await ctx.db
    .query("playoffManualGroups")
    .withIndex("by_season_stage", (q) => q.eq("seasonId", season._id))
    .collect();
  for (const row of manualGroups) {
    if (!keepsManualGroups(prev, format, row.stageId)) await ctx.db.delete(row._id);
  }
}

// Commissioner only - see applyFormat.
export const setFormat = mutation({
  args: { seasonId: v.id("seasons"), format: v.union(v.any(), v.null()) },
  handler: async (ctx, args): Promise<void> => {
    const { season, isCommissioner } = await requireSeasonViewer(ctx, args.seasonId);
    if (!isCommissioner) throw new Error("Only the commissioner can change the playoff rules.");
    await applyFormat(ctx, season, args.format as PlayoffFormat | null);
  },
});

// Commissioner only: sets a group stage's groups and weekly games by hand,
// in place of its matchup draft or serpentine deal - or, with null, hands
// the stage back to its formation. Any team can go in a group; the stage's
// entrants become whoever's in them.
export const setManualGroups = mutation({
  args: {
    seasonId: v.id("seasons"),
    stageId: v.string(),
    groups: v.union(
      v.array(
        v.object({
          teamIds: v.array(v.id("seasonTeams")),
          pairs: v.array(v.object({ week: v.number(), teamIds: v.array(v.id("seasonTeams")) })),
        }),
      ),
      v.null(),
    ),
  },
  handler: async (ctx, args): Promise<void> => {
    const { userId, isCommissioner } = await requireSeasonViewer(ctx, args.seasonId);
    if (!isCommissioner) throw new Error("Only the commissioner can set the groups.");
    const existing = await ctx.db
      .query("playoffManualGroups")
      .withIndex("by_season_stage", (q) =>
        q.eq("seasonId", args.seasonId).eq("stageId", args.stageId),
      )
      .unique();
    if (args.groups === null) {
      if (existing) await ctx.db.delete(existing._id);
      return;
    }

    const settings = await ctx.db
      .query("playoffSettings")
      .withIndex("by_season", (q) => q.eq("seasonId", args.seasonId))
      .unique();
    const stage = (settings?.format as PlayoffFormat | undefined)?.stages.find(
      (s) => s.id === args.stageId,
    );
    if (stage?.kind !== "groups") throw new Error("That stage doesn't have groups.");
    if (args.groups.some((group) => group.pairs.some((pair) => pair.teamIds.length !== 2))) {
      throw new Error("Every game needs two teams.");
    }
    const teams = await ctx.db
      .query("seasonTeams")
      .withIndex("by_season", (q) => q.eq("seasonId", args.seasonId))
      .collect();
    const manual: ManualGroups = {
      groups: args.groups.map((group) => ({
        teamIds: group.teamIds,
        pairs: group.pairs.map((pair) => ({
          week: pair.week,
          teamIds: [pair.teamIds[0]!, pair.teamIds[1]!],
        })),
      })),
    };
    const problem = manualGroupsProblem(
      stage,
      manual,
      teams.map((team) => team._id),
    );
    if (problem) throw new Error(problem);

    const row = { groups: args.groups, updatedByUserId: userId, updatedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, row);
    else {
      await ctx.db.insert("playoffManualGroups", {
        seasonId: args.seasonId,
        stageId: args.stageId,
        ...row,
      });
    }
  },
});
