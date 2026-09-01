import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import { requireDraftOwner, requireRealDraft } from "../../lib/access";
import { stepPickOrder } from "./pickOrder";

// Thin, name-preserving alias - the actual rotation math moved to
// pickOrder.ts's stepPickOrder (SNAKE_DRAFT.md §3.1) so a real snake
// draft's turn tracking can share it instead of duplicating it. Kept under
// this name here since every existing call site (picks.ts's nominate())
// still reasons about it as "who nominates next," not the more general
// "who picks next" - no behavior change either way.
export const nextNominator = stepPickOrder;

export const getCurrentNominator = query({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args) => {
    const { draft } = await requireDraftOwner(ctx, args.seasonId);
    // setNominationOrder/setDraftOrder seed this row's currentTeamId as soon
    // as an order is configured, which normally happens pre-draft - without
    // this check, that seeded team would show as "on the clock"/"currently
    // nominating" before the host has actually clicked Start Draft (or a
    // live draft integration has flipped the draft's status). Gating here
    // (rather than in every frontend consumer) also means reopenPreDraft
    // clears the displayed turn "for free," just by unsetting startedAt.
    if (draft.startedAt === undefined) return null;
    return await ctx.db
      .query("draftNominationTurns")
      .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
      .first();
  },
});

// The draft's configured nomination order + mode - moved off the old
// draftSettings row onto drafts (see schema.ts), so callers that need to
// sort teams by nomination order (e.g. the TV board) fetch it here instead
// of reading it directly off a season/league doc.
export const getNominationConfig = query({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args) => {
    const { draft } = await requireDraftOwner(ctx, args.seasonId);
    return {
      nominationOrder: draft.nominationOrder,
      nominationOrderMode: draft.nominationOrderMode,
    };
  },
});

// Read-only, no-ownership-check counterparts to getCurrentNominator and
// getNominationConfig for the TV board (src/pages/DraftBoard/DraftBoard.tsx)
// - meant to be viewable by anyone with the link, not just the league's
// owner (see convex/leagues.ts's getSeasonPublic for the same reasoning).
export const getCurrentNominatorPublic = query({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args) => {
    const draft = await requireRealDraft(ctx, args.seasonId);
    // See getCurrentNominator's comment above - same pre-start gating.
    if (draft.startedAt === undefined) return null;
    return await ctx.db
      .query("draftNominationTurns")
      .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
      .first();
  },
});

export const getNominationConfigPublic = query({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args) => {
    const draft = await requireRealDraft(ctx, args.seasonId);
    return {
      nominationOrder: draft.nominationOrder,
      nominationOrderMode: draft.nominationOrderMode,
    };
  },
});

// Configures (or reconfigures) the nomination order + mode. teamIds must be
// exactly the draft's current teams, each once - a partial or stale list
// would silently drop a team from the rotation, which is worse than just
// rejecting it. Starts the turn pointer at the order's first team only the
// very first time an order is set for this draft (a mid-draft edit to an
// already-running order shouldn't reset whose turn it is).
export const setNominationOrder = mutation({
  args: {
    seasonId: v.id("seasons"),
    teamIds: v.array(v.id("seasonTeams")),
    mode: v.union(v.literal("linear"), v.literal("snake")),
  },
  handler: async (ctx, args) => {
    const { draft } = await requireDraftOwner(ctx, args.seasonId);

    const teams = await ctx.db
      .query("seasonTeams")
      .withIndex("by_season", (q) => q.eq("seasonId", args.seasonId))
      .collect();
    const teamIdSet = new Set(teams.map((t) => t._id));
    const uniqueGiven = new Set(args.teamIds);
    if (
      teams.length === 0 ||
      args.teamIds.length !== teams.length ||
      uniqueGiven.size !== teams.length ||
      args.teamIds.some((id) => !teamIdSet.has(id))
    ) {
      throw new Error(
        "Nomination order must include every team in this draft exactly once.",
      );
    }

    await ctx.db.patch(draft._id, {
      nominationOrder: args.teamIds,
      nominationOrderMode: args.mode,
    });

    const existingTurn = await ctx.db
      .query("draftNominationTurns")
      .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
      .first();
    if (!existingTurn) {
      await ctx.db.insert("draftNominationTurns", {
        draftId: draft._id,
        currentTeamId: args.teamIds[0]!,
        direction: 1,
        updatedAt: Date.now(),
      });
    } else if (
      existingTurn.currentTeamId !== null &&
      !uniqueGiven.has(existingTurn.currentTeamId)
    ) {
      // The team whose turn it was is no longer in the (re-saved) order -
      // clear to manual rather than silently pointing at a stale team.
      await ctx.db.patch(existingTurn._id, {
        currentTeamId: null,
        direction: 1,
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});

// Back to fully manual: no order, no suggested turn.
export const clearNominationOrder = mutation({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args) => {
    const { draft } = await requireDraftOwner(ctx, args.seasonId);
    await ctx.db.patch(draft._id, {
      nominationOrder: undefined,
      nominationOrderMode: undefined,
    });
    const existingTurn = await ctx.db
      .query("draftNominationTurns")
      .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
      .first();
    if (existingTurn) {
      await ctx.db.delete(existingTurn._id);
    }
    return null;
  },
});

// Explicit host override - jump "whose turn" to any team, or to null (e.g.
// to run a pre-cycle top-X auction with no fixed nominator before the
// regular rotation starts/resumes). Always resets direction to 1: simplest
// predictable default for snake mode, and the host can nominate a couple
// times to nudge it back on track if that guess is wrong.
export const setCurrentNominator = mutation({
  args: {
    seasonId: v.id("seasons"),
    teamId: v.union(v.id("seasonTeams"), v.null()),
  },
  handler: async (ctx, args) => {
    const { draft } = await requireDraftOwner(ctx, args.seasonId);
    const existingTurn = await ctx.db
      .query("draftNominationTurns")
      .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
      .first();
    if (existingTurn) {
      await ctx.db.patch(existingTurn._id, {
        currentTeamId: args.teamId,
        direction: 1,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("draftNominationTurns", {
        draftId: draft._id,
        currentTeamId: args.teamId,
        direction: 1,
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});
