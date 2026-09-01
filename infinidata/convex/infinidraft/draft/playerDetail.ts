import { v } from "convex/values";
import { query } from "../../_generated/server";
import { requireDraftOwner } from "../../lib/access";

// Single-player read composing every per-record (not pool-relative) field
// the detail modal needs: identity, this-week projection/ranking, current
// injury status, and - only when seasonId is passed - this draft's
// pick/keeper status and target/avoid tag. Pool-relative fields (news list,
// value-gap signal, $ draft value) are deliberately NOT here - the modal
// reads those via news.getNewsForFpids / valueGaps.getAllValueGaps /
// draftValues.getDraftValues directly so this query never duplicates that
// pool-computation logic.
export const getPlayerDetail = query({
  args: {
    fpid: v.number(),
    week: v.string(),
    seasonId: v.optional(v.id("seasons")),
  },
  handler: async (ctx, args) => {
    // Only enforce draft ownership when draft-scoped fields are requested -
    // identity/projection/injury are public reads (same as players.getPlayer/
    // injuries.getInjuries today), so this still works with no league
    // selected (e.g. the pre-draft Players tab before any league exists).
    let draftId = null;
    // A maxConsecutiveYears cap is what drives showing the Yr N badge below -
    // no cap set (unlimited) means the league doesn't track streaks. Only
    // matters when a pick/keeper is actually returned below, but computed
    // alongside draftId (same season lookup) rather than a second round trip.
    let trackConsecutiveYears = false;
    if (args.seasonId) {
      const { season, draft } = await requireDraftOwner(ctx, args.seasonId);
      draftId = draft._id;
      trackConsecutiveYears =
        season.keeperRules?.maxConsecutiveYears !== undefined;
    }

    const player = await ctx.db
      .query("players")
      .withIndex("by_fpid", (q) => q.eq("fpid", args.fpid))
      .first();
    if (!player) return null;

    const [projection, ranking, injury] = await Promise.all([
      ctx.db
        .query("projections")
        .withIndex("by_position_week_fpid", (q) =>
          q
            .eq("position", player.position)
            .eq("week", args.week)
            .eq("fpid", args.fpid),
        )
        .first(),
      ctx.db
        .query("rankings")
        .withIndex("by_position_week_fpid", (q) =>
          q
            .eq("position", player.position)
            .eq("week", args.week)
            .eq("fpid", args.fpid),
        )
        .first(),
      ctx.db
        .query("injuries")
        .withIndex("by_fpid", (q) => q.eq("fpid", args.fpid))
        .first(),
    ]);

    let pick = null;
    let tag: "target" | "avoid" | null = null;
    if (draftId) {
      const [pickRow, tagRow] = await Promise.all([
        ctx.db
          .query("draftPicks")
          .withIndex("by_draft_fpid", (q) =>
            q.eq("draftId", draftId).eq("fpid", args.fpid),
          )
          .first(),
        ctx.db
          .query("draftPlayerTags")
          .withIndex("by_draft_fpid", (q) =>
            q.eq("draftId", draftId).eq("fpid", args.fpid),
          )
          .first(),
      ]);
      pick = pickRow;
      tag = tagRow?.tag ?? null;
    }

    return {
      player,
      projection,
      ranking,
      injury,
      pick,
      tag,
      trackConsecutiveYears,
    };
  },
});
