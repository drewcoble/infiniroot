import { v } from "convex/values";
import { query, mutation, type QueryCtx, type MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import { scoringConfigValidator } from "../scoring";
import { requireSeasonOwner } from "./auth";
import { hasProAccess } from "../billing/entitlements";
import { buildInputsFingerprint } from "../gemini/preDraftInsights";

// Resolves this season's kept fpids for the staleness fingerprint below -
// keepers live on draftPicks (keyed by draftId, not seasonId), so this
// needs the real draft first. A season with no draft yet (shouldn't happen -
// convex/leagues.ts creates one atomically) just has no keepers.
async function listKeeperFpids(
  ctx: QueryCtx | MutationCtx,
  seasonId: Id<"seasons">,
): Promise<number[]> {
  const draft = await ctx.db
    .query("drafts")
    .withIndex("by_season_kind", (q) =>
      q.eq("seasonId", seasonId).eq("kind", "real"),
    )
    .first();
  if (!draft) return [];
  const keepers = await ctx.db
    .query("draftPicks")
    .withIndex("by_draft_keeper", (q) =>
      q.eq("draftId", draft._id).eq("isKeeper", true),
    )
    .collect();
  return keepers.map((k) => k.fpid);
}

// Owner-only (this page is never a public/shareable link, unlike Report
// Card - see convex/draft/reportCard.ts's getDraftReportCardPublic comment
// for that contrast), so gating on the calling user's own Pro status is
// equivalent to gating on league.ownerId here: requireSeasonOwner already
// throws unless the caller IS the owner.
export const getPreDraftInsights = query({
  args: {
    seasonId: v.id("seasons"),
    week: v.string(),
    scoringConfig: scoringConfigValidator,
  },
  handler: async (ctx, args) => {
    const { season, league } = await requireSeasonOwner(ctx, args.seasonId);
    if (!(await hasProAccess(ctx, league.ownerId))) {
      return { status: "requires_upgrade" as const };
    }

    const cached = await ctx.db
      .query("preDraftInsights")
      .withIndex("by_season_week_scoring", (q) =>
        q
          .eq("seasonId", args.seasonId)
          .eq("week", args.week)
          .eq("scoring", args.scoringConfig.scoring),
      )
      .unique();
    if (!cached) return { status: "ok" as const, data: null };

    const keeperFpids = await listKeeperFpids(ctx, args.seasonId);
    const currentFingerprint = buildInputsFingerprint(season, keeperFpids);

    return {
      status: "ok" as const,
      data: {
        insights: cached.insights,
        model: cached.model,
        generatedAt: cached.generatedAt,
      },
      isStale: currentFingerprint !== cached.inputsFingerprint,
    };
  },
});

// Frontend-triggered backfill, same convention as convex/draft/reportCard.ts's
// ensureReportSummaryGenerated - fires once per page view whenever there's
// no cached row yet; idempotent (checks for an existing row, and
// generatePreDraftInsights itself re-checks before spending a Gemini call).
// Silently no-ops for a non-Pro caller rather than throwing - this runs
// automatically on page load, not from a user-clicked button, so there's no
// one waiting on an error message.
export const ensureInsightsGenerated = mutation({
  args: {
    seasonId: v.id("seasons"),
    week: v.string(),
    scoringConfig: scoringConfigValidator,
  },
  handler: async (ctx, args) => {
    await requireSeasonOwner(ctx, args.seasonId);
    const userId = await getAuthUserId(ctx);
    if (!userId || !(await hasProAccess(ctx, userId))) return;

    const existing = await ctx.db
      .query("preDraftInsights")
      .withIndex("by_season_week_scoring", (q) =>
        q
          .eq("seasonId", args.seasonId)
          .eq("week", args.week)
          .eq("scoring", args.scoringConfig.scoring),
      )
      .unique();
    if (existing) return;

    await ctx.scheduler.runAfter(
      0,
      internal.gemini.preDraftInsights.generatePreDraftInsights,
      args,
    );
  },
});

// Manual "Regenerate"/"Refresh" action - clears whatever's cached (stale or
// not) and re-schedules generation, same pattern as
// convex/draft/reportCard.ts's regenerateReportSummary. Throws for a non-Pro
// caller (unlike ensureInsightsGenerated above) since this is a deliberate,
// user-clicked action that should surface an error rather than silently
// doing nothing.
export const regenerateInsights = mutation({
  args: {
    seasonId: v.id("seasons"),
    week: v.string(),
    scoringConfig: scoringConfigValidator,
  },
  handler: async (ctx, args) => {
    await requireSeasonOwner(ctx, args.seasonId);
    const userId = await getAuthUserId(ctx);
    if (!userId || !(await hasProAccess(ctx, userId))) {
      throw new Error("AI Insights is a Pro feature.");
    }

    const existing = await ctx.db
      .query("preDraftInsights")
      .withIndex("by_season_week_scoring", (q) =>
        q
          .eq("seasonId", args.seasonId)
          .eq("week", args.week)
          .eq("scoring", args.scoringConfig.scoring),
      )
      .collect();
    for (const row of existing) await ctx.db.delete(row._id);

    await ctx.scheduler.runAfter(
      0,
      internal.gemini.preDraftInsights.generatePreDraftInsights,
      args,
    );
  },
});
