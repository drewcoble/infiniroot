import { v } from "convex/values";
import { mutation, type MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { requireSeasonViewer } from "../lib/access";
import type { MatchupDraftFormation, PlayoffFormat } from "../lib/playoffRules/format";

// The matchup draft's three steps - slots, picks, rematches. Each checks
// turn order against the draft row (drafters and pool are fixed there when
// the regular season goes final - see season.ts's ensureDraft). A drafter
// team's members act for it; the commissioner can act for any drafter.

async function loadDraft(
  ctx: MutationCtx,
  seasonId: Id<"seasons">,
  stageId: string,
  drafterId: Id<"seasonTeams">,
): Promise<{ draft: Doc<"playoffDrafts">; formation: MatchupDraftFormation; userId: Id<"users"> }> {
  const { userId, isCommissioner, teamIds } = await requireSeasonViewer(ctx, seasonId);
  if (!isCommissioner && !teamIds.includes(drafterId)) {
    throw new Error("Only that team (or the commissioner) can make this pick.");
  }
  const settings = await ctx.db
    .query("playoffSettings")
    .withIndex("by_season", (q) => q.eq("seasonId", seasonId))
    .unique();
  const stage = (settings?.format as PlayoffFormat | undefined)?.stages.find(
    (s) => s.id === stageId,
  );
  if (stage?.kind !== "groups" || stage.formation.kind !== "matchupDraft") {
    throw new Error("This stage has no matchup draft.");
  }
  const draft = await ctx.db
    .query("playoffDrafts")
    .withIndex("by_season_stage", (q) => q.eq("seasonId", seasonId).eq("stageId", stageId))
    .unique();
  if (!draft) throw new Error("The draft opens once the regular season is final.");
  if (!draft.drafterIds.includes(drafterId)) throw new Error("That team isn't a drafter.");
  return { draft, formation: stage.formation, userId };
}

function slotOrder(draft: Doc<"playoffDrafts">): Id<"seasonTeams">[] {
  return [...draft.slots].sort((a, b) => a.slot - b.slot).map((s) => s.drafterId);
}

function onTheClock(draft: Doc<"playoffDrafts">, formation: MatchupDraftFormation) {
  const order = slotOrder(draft);
  const round = Math.floor(draft.picks.length / order.length);
  if (round >= formation.draftWeeks.length) return null;
  const forward = !formation.snake || round % 2 === 0;
  const index = draft.picks.length % order.length;
  return (forward ? order : [...order].reverse())[index] ?? null;
}

const pickArgs = {
  seasonId: v.id("seasons"),
  stageId: v.string(),
  drafterId: v.id("seasonTeams"),
};

// Drafters choose their slots in seed order.
export const chooseSlot = mutation({
  args: { ...pickArgs, slot: v.number() },
  handler: async (ctx, args): Promise<void> => {
    const { draft } = await loadDraft(ctx, args.seasonId, args.stageId, args.drafterId);
    const next = draft.drafterIds.find((id) => !draft.slots.some((s) => s.drafterId === id));
    if (next !== args.drafterId) throw new Error("It isn't this team's turn to choose a slot.");
    if (!Number.isInteger(args.slot) || args.slot < 1 || args.slot > draft.drafterIds.length) {
      throw new Error("That slot doesn't exist.");
    }
    if (draft.slots.some((s) => s.slot === args.slot)) throw new Error("That slot is taken.");
    await ctx.db.patch(draft._id, {
      slots: [...draft.slots, { drafterId: args.drafterId, slot: args.slot }],
    });
  },
});

export const makePick = mutation({
  args: { ...pickArgs, opponentId: v.id("seasonTeams"), week: v.number() },
  handler: async (ctx, args): Promise<void> => {
    const { draft, formation, userId } = await loadDraft(
      ctx,
      args.seasonId,
      args.stageId,
      args.drafterId,
    );
    if (draft.slots.length < draft.drafterIds.length) {
      throw new Error("Every drafter has to choose a slot first.");
    }
    if (onTheClock(draft, formation) !== args.drafterId) {
      throw new Error("This team isn't on the clock.");
    }
    if (!draft.poolIds.includes(args.opponentId)) throw new Error("That team can't be drafted.");
    if (draft.picks.some((p) => p.opponentId === args.opponentId)) {
      throw new Error("That team has already been drafted.");
    }
    if (!formation.draftWeeks.includes(args.week)) throw new Error("That week isn't in the draft.");
    if (draft.picks.some((p) => p.drafterId === args.drafterId && p.week === args.week)) {
      throw new Error("This team already has a matchup that week.");
    }
    await ctx.db.patch(draft._id, {
      picks: [
        ...draft.picks,
        {
          drafterId: args.drafterId,
          opponentId: args.opponentId,
          week: args.week,
          pickedByUserId: userId,
          pickedAt: Date.now(),
        },
      ],
    });
  },
});

// Any time after the draft, until the rematch week kicks off - drafters
// can change their mind until then.
export const chooseRematch = mutation({
  args: { ...pickArgs, opponentId: v.id("seasonTeams"), week: v.number() },
  handler: async (ctx, args): Promise<void> => {
    const { draft, formation, userId } = await loadDraft(
      ctx,
      args.seasonId,
      args.stageId,
      args.drafterId,
    );
    if (onTheClock(draft, formation) !== null || draft.slots.length < draft.drafterIds.length) {
      throw new Error("The draft isn't finished yet.");
    }
    if (!formation.rematchWeeks.includes(args.week)) throw new Error("That isn't a rematch week.");
    const groupMates = draft.picks
      .filter((p) => p.drafterId === args.drafterId)
      .map((p) => p.opponentId);
    if (!groupMates.includes(args.opponentId)) throw new Error("Pick a team from your group.");
    const nflState = await ctx.db.query("nflState").first();
    if (nflState && Number(nflState.week) >= args.week) {
      throw new Error("That week has already started.");
    }
    await ctx.db.patch(draft._id, {
      rematches: [
        ...draft.rematches.filter((r) => !(r.drafterId === args.drafterId && r.week === args.week)),
        {
          drafterId: args.drafterId,
          opponentId: args.opponentId,
          week: args.week,
          pickedByUserId: userId,
          pickedAt: Date.now(),
        },
      ],
    });
  },
});

// Commissioner only: takes back the most recent pick, else the most recent
// slot.
export const undoLast = mutation({
  args: { seasonId: v.id("seasons"), stageId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const { isCommissioner } = await requireSeasonViewer(ctx, args.seasonId);
    if (!isCommissioner) throw new Error("Only the commissioner can undo picks.");
    const draft = await ctx.db
      .query("playoffDrafts")
      .withIndex("by_season_stage", (q) =>
        q.eq("seasonId", args.seasonId).eq("stageId", args.stageId),
      )
      .unique();
    if (!draft) return;
    if (draft.picks.length > 0) await ctx.db.patch(draft._id, { picks: draft.picks.slice(0, -1) });
    else if (draft.slots.length > 0) {
      await ctx.db.patch(draft._id, { slots: draft.slots.slice(0, -1) });
    }
  },
});
