import { v } from "convex/values";
import { mutation } from "../../_generated/server";
import { positionValidator } from "../../positions";
import { requireDraftStarted } from "../../lib/access";

// Escape hatch for a real player the app has no data for - too recent a
// signing/trade for Sleeper's own projections/ADP to have caught up, or
// obscure enough to fall outside the relevant-players cutoff (see
// filterRelevantPlayers's RELEVANT_ADP_CEILING) - so search in the
// nomination panel comes up empty. Mints a synthetic fpid and writes it into
// the same `players`/`projections` tables every real player lives in, so
// nominating, drafting, and every existing fpid->name/team/position lookup
// across the app (TV board, draft tables, player detail modal, keeper
// carryover, etc.) works unmodified - the caller nominates the returned
// fpid through the normal nominate mutation right after this.
export const addCustomPlayer = mutation({
  args: {
    seasonId: v.id("seasons"),
    name: v.string(),
    position: positionValidator,
    // Matches whatever week the caller's own getAllProjections subscription
    // is reading (src/constants/general.ts's WEEK) so the projections row
    // below actually shows up in it.
    week: v.string(),
  },
  handler: async (ctx, args) => {
    const { season } = await requireDraftStarted(ctx, args.seasonId);

    const name = args.name.trim();
    if (!name) {
      throw new Error("Enter a player name.");
    }

    // The nomination panel's search is scoped to filterRelevantPlayers's
    // ADP cutoff, so a real tracked player can still come up empty there
    // even though we already have a row (and real projections, and any
    // espnId/yahooId) for them - reuse that identity instead of minting a
    // duplicate synthetic one whenever the typed name matches an existing
    // player at the same position.
    const normalizedName = name.toLowerCase();
    const existingMatch = (await ctx.db.query("players").collect()).find(
      (player) =>
        player.position === args.position &&
        player.name.trim().toLowerCase() === normalizedName,
    );
    if (existingMatch) {
      return existingMatch.fpid;
    }

    // Always negative so this can never collide with a real Sleeper fpid or
    // this app's own DST synthetic ids (90001+, see sleeper/client.ts's
    // DEF_TEAM_FPIDS) - both are always positive. The while loop only ever
    // matters if two custom players are added in the same millisecond.
    let fpid = -Date.now();
    while (
      await ctx.db
        .query("players")
        .withIndex("by_fpid", (q) => q.eq("fpid", fpid))
        .first()
    ) {
      fpid -= 1;
    }

    const now = Date.now();
    await ctx.db.insert("players", {
      fpid,
      name,
      position: args.position,
      team: null,
      updatedAt: now,
    });

    // $0/no-stats row, immune to the daily Sleeper/ESPN refetch's stale-row
    // prune (see projections.ts's upsertProjections, which skips negative
    // fpids specifically for this) - so this keeps resolving everywhere
    // getAllProjections is read, indefinitely, without a parallel lookup
    // path in every one of those call sites.
    await ctx.db.insert("projections", {
      fpid,
      season: season.year,
      week: args.week,
      position: args.position,
      name,
      team: null,
      pointsStd: 0,
      pointsPpr: 0,
      pointsHalf: 0,
      stats: {},
      fetchedAt: now,
    });

    return fpid;
  },
});
