import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  requireDraftOwner,
  requireDraftNotStarted,
  requireRealDraft,
} from "./auth";
import { resolveTeamPositionInRound } from "./pickOrder";
import { countForfeitedByRound, countRealSlotsThroughRound } from "./pickSlots";
import { resolveDraftType } from "../draftType";

// Snake/linear counterpart to nominationOrder.ts's setNominationOrder/
// getNominationConfig - same validation shape (teamIds must be exactly the
// draft's current teams, each once), but configures drafts.draftOrder
// instead of drafts.nominationOrder (SNAKE_DRAFT.md §3.1). Turn tracking
// itself is shared, not duplicated here - see nominationOrder.ts's
// getCurrentNominator/getCurrentNominatorPublic, which read
// draftNominationTurns generically enough to serve a snake/linear draft's
// "whose turn" too.
//
// Locked to pre-draft (requireDraftNotStarted), unlike setNominationOrder
// (requireDraftOwner, reconfigurable anytime): auction's nomination order is
// only ever a soft suggestion, but a real snake/linear draft's order is
// meant to be authoritative (see schema.ts's comment on draftOrder) -
// changing it mid-draft would retroactively make every already-recorded
// pick's round/pickInRound wrong.

export const getDraftOrderConfig = query({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args) => {
    const { draft } = await requireDraftOwner(ctx, args.seasonId);
    return {
      draftOrder: draft.draftOrder,
      reversalRounds: draft.reversalRounds,
    };
  },
});

// Read-only, no-ownership-check counterpart for the TV board, same
// reasoning as getNominationConfigPublic.
export const getDraftOrderConfigPublic = query({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args) => {
    const draft = await requireRealDraft(ctx, args.seasonId);
    return {
      draftOrder: draft.draftOrder,
      reversalRounds: draft.reversalRounds,
    };
  },
});

// Host-supplied set of "reversal" round boundaries (SNAKE_DRAFT.md §10,
// e.g. 3rd-round reversal: reversalRounds: [3]) - a listed round repeats the
// PREVIOUS round's direction instead of alternating, rather than the usual
// bounce-and-flip (see pickOrder.ts's rawStep/resolveTeamPositionInRound for
// the actual mechanics). Locked to pre-draft same as setDraftOrder -
// changing this after picks exist would retroactively change which
// direction an already-recorded round "should" have gone. Round 1 can't be
// a reversal (there's no previous direction to repeat), so it's rejected
// same as a non-positive round.
export const setReversalRounds = mutation({
  args: {
    seasonId: v.id("seasons"),
    reversalRounds: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    const { season, draft } = await requireDraftNotStarted(ctx, args.seasonId);
    if (
      args.reversalRounds.some((round) => !Number.isInteger(round) || round < 2)
    ) {
      throw new Error(
        "Reversal rounds must be whole numbers, round 2 or later.",
      );
    }
    const deduped = [...new Set(args.reversalRounds)].sort((a, b) => a - b);
    await ctx.db.patch(draft._id, { reversalRounds: deduped });
    // Reversal rounds feed resolveTeamPositionInRound exactly like
    // draftOrder does (they flip which round-boundaries bounce vs. repeat),
    // so an existing keeper's pickInRound/overallPick goes just as stale
    // here as it would from a draftOrder change - same reconciliation.
    await reconcileKeeperSlots(
      ctx,
      season,
      draft,
      draft.draftOrder ?? [],
      deduped,
    );
    return null;
  },
});

// Recomputes pickInRound/overallPick for every existing round-based keeper
// after draftOrder or reversalRounds changes. A keeper's `round` is chosen
// by the cost formula (addKeeper's resolveRoundConflict) and never depends
// on team order, but pickInRound (this team's position *within* that
// round) and overallPick (a denormalization of it) both come from
// resolveTeamPositionInRound(draftOrder, ...) at the moment the keeper was
// set - so left untouched, they'd silently point at the wrong slot (and
// potentially the wrong team's column on the board) the instant the order
// changes under them. Safe to recompute pickInRound alone without rerunning
// resolveRoundConflict: for a fixed round, resolveTeamPositionInRound is a
// bijection between teams and positions, so reordering can never create a
// *new* same-round collision between two teams - only a same-team,
// same-round collision could do that, and that's determined by `round`
// itself, which this leaves untouched.
async function reconcileKeeperSlots(
  ctx: MutationCtx,
  season: Doc<"seasons">,
  draft: Doc<"drafts">,
  draftOrder: readonly Id<"seasonTeams">[],
  reversalRounds: readonly number[],
): Promise<void> {
  const draftType = resolveDraftType(season, draft);
  if (draftType === "auction" || draftOrder.length === 0) return;

  const picks = await ctx.db
    .query("draftPicks")
    .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
    .collect();
  const roundBasedKeepers = picks.filter(
    (p) => p.isKeeper && p.round !== undefined,
  );
  if (roundBasedKeepers.length === 0) return;

  const forfeitedByRound = await countForfeitedByRound(ctx, draft._id);
  const teamCount = draftOrder.length;
  for (const pick of roundBasedKeepers) {
    const round = pick.round!;
    const position = resolveTeamPositionInRound(
      draftOrder,
      draftType,
      reversalRounds,
      round,
      pick.teamId,
    );
    if (position === null) continue;
    const overallPick =
      countRealSlotsThroughRound(round - 1, teamCount, forfeitedByRound) +
      position;
    if (pick.pickInRound !== position || pick.overallPick !== overallPick) {
      await ctx.db.patch(pick._id, { pickInRound: position, overallPick });
    }
  }
}

// Shared by setDraftOrder and randomizeDraftOrder below - both end up
// wanting the exact same "persist the order, seed/reset the turn pointer,
// reconcile existing keepers" steps, just from a different source for
// teamIds (host-supplied vs. shuffled). Starts the turn pointer at the
// order's first team only the very first time an order is set for this
// draft (re-randomizing after an edit shouldn't reset whose turn it is,
// mirroring setNominationOrder).
async function applyDraftOrder(
  ctx: MutationCtx,
  season: Doc<"seasons">,
  draft: Doc<"drafts">,
  teamIds: Id<"seasonTeams">[],
): Promise<void> {
  await ctx.db.patch(draft._id, { draftOrder: teamIds });
  await reconcileKeeperSlots(
    ctx,
    season,
    draft,
    teamIds,
    draft.reversalRounds ?? [],
  );

  const uniqueGiven = new Set(teamIds);
  const existingTurn = await ctx.db
    .query("draftNominationTurns")
    .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
    .first();
  if (!existingTurn) {
    await ctx.db.insert("draftNominationTurns", {
      draftId: draft._id,
      currentTeamId: teamIds[0]!,
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
}

function validateTeamIds(
  teams: Doc<"seasonTeams">[],
  teamIds: Id<"seasonTeams">[],
): void {
  const teamIdSet = new Set(teams.map((t) => t._id));
  const uniqueGiven = new Set(teamIds);
  if (
    teams.length === 0 ||
    teamIds.length !== teams.length ||
    uniqueGiven.size !== teams.length ||
    teamIds.some((id) => !teamIdSet.has(id))
  ) {
    throw new Error(
      "Draft order must include every team in this draft exactly once.",
    );
  }
}

// Explicit host-supplied order (e.g. "away from the board" manual entry, or
// confirming a synced provider draft slot order - SNAKE_DRAFT.md §6).
export const setDraftOrder = mutation({
  args: {
    seasonId: v.id("seasons"),
    teamIds: v.array(v.id("seasonTeams")),
  },
  handler: async (ctx, args) => {
    const { season, draft } = await requireDraftNotStarted(ctx, args.seasonId);
    const teams = await ctx.db
      .query("seasonTeams")
      .withIndex("by_season", (q) => q.eq("seasonId", args.seasonId))
      .collect();
    validateTeamIds(teams, args.teamIds);
    await applyDraftOrder(ctx, season, draft, args.teamIds);
    return null;
  },
});

// Shuffles this season's current teams into a fresh draft order - the
// "randomize draft order" action flagged as a likely-needed Setup
// interaction in SNAKE_DRAFT.md §3.1/§14. Fisher-Yates, using Math.random -
// not cryptographically significant, just needs to look fair to a
// commissioner running a live draft.
export const randomizeDraftOrder = mutation({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args): Promise<Id<"seasonTeams">[]> => {
    const { season, draft } = await requireDraftNotStarted(ctx, args.seasonId);
    const teams = await ctx.db
      .query("seasonTeams")
      .withIndex("by_season", (q) => q.eq("seasonId", args.seasonId))
      .collect();
    if (teams.length === 0) {
      throw new Error(
        "Add at least one team before randomizing the draft order.",
      );
    }

    const shuffled = teams.map((t) => t._id);
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }

    await applyDraftOrder(ctx, season, draft, shuffled);
    return shuffled;
  },
});

// Back to unset - the draft order equivalent of clearNominationOrder.
export const clearDraftOrder = mutation({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args) => {
    const { draft } = await requireDraftNotStarted(ctx, args.seasonId);
    await ctx.db.patch(draft._id, { draftOrder: undefined });
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
