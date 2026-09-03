import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, internalQuery } from "./_generated/server";
import { Doc } from "./_generated/dataModel";

// Shared by both provider syncs (convex/sleeper/league.ts's syncLeagueRoster
// and convex/infinidraft/yahoo/league.ts's syncYahooLeagueRoster), which both apps'
// season-roster-sync flows ultimately trigger - both need "confirm the
// caller owns this season" (via its league) before touching its
// rosterPlayers/faabSpent, and neither check has anything provider- or
// app-specific about it. Returns the league too since syncYahooLeagueRoster
// needs league.ownerId to look up the Yahoo token (Yahoo connections are
// per-app-user, not per-season). Kept shared at the root, not under either
// app's slice, since infinidraft's own sync (convex/sleeper/draftSync.ts,
// convex/infinidraft/yahoo/league.ts) and infinileague's both depend on it.
export const requireOwnedSeasonForSync = internalQuery({
  args: { seasonId: v.id("seasons") },
  handler: async (
    ctx,
    args,
  ): Promise<{ season: Doc<"seasons">; league: Doc<"leagues"> }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("You must be signed in.");
    }
    const season = await ctx.db.get(args.seasonId);
    if (!season) {
      throw new Error("Season not found.");
    }
    const league = await ctx.db.get(season.leagueId);
    if (!league) {
      throw new Error("League not found.");
    }
    if (league.ownerId !== userId) {
      throw new Error("Not authorized to sync this league.");
    }
    return { season, league };
  },
});

// Shared write path for both provider syncs (convex/sleeper/league.ts's
// syncLeagueRoster and convex/infinidraft/yahoo/league.ts's syncYahooLeagueRoster) -
// replace-all-on-sync for one team's roster. See schema.ts's rosterPlayers
// comment for why this table (and this mutation) is provider-agnostic.
export const replaceRosterForTeam = internalMutation({
  args: {
    seasonId: v.id("seasons"),
    teamId: v.id("seasonTeams"),
    fpids: v.array(v.number()),
    faabSpent: v.number(),
    // Current-season standings, synced alongside the roster itself - see
    // convex/infinileague/season/standings.ts and schema.ts's seasonTeams
    // comment. waiverPosition is genuinely absent for a FAAB league (not
    // just 0), so it stays optional; the others always come back from
    // Sleeper.
    wins: v.number(),
    losses: v.number(),
    ties: v.number(),
    pointsFor: v.number(),
    pointsAgainst: v.number(),
    waiverPosition: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("rosterPlayers")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .collect();
    for (const row of existing) {
      await ctx.db.delete(row._id);
    }
    const syncedAt = Date.now();
    for (const fpid of args.fpids) {
      await ctx.db.insert("rosterPlayers", {
        seasonId: args.seasonId,
        teamId: args.teamId,
        fpid,
        syncedAt,
      });
    }
    await ctx.db.patch(args.teamId, {
      faabSpent: args.faabSpent,
      wins: args.wins,
      losses: args.losses,
      ties: args.ties,
      pointsFor: args.pointsFor,
      pointsAgainst: args.pointsAgainst,
      ...(args.waiverPosition !== undefined
        ? { waiverPosition: args.waiverPosition }
        : {}),
    });
  },
});

// Companion to replaceRosterForTeam - season-level (not per-team) waiver
// settings, re-written on every sync rather than only at connect time (see
// convex/sleeper/league.ts's syncLeagueRoster for why). Provider-agnostic
// shape (just patches season fields) even though only the Sleeper sync
// calls it today - same convention as replaceRosterForTeam.
export const updateSeasonWaiverSettings = internalMutation({
  args: {
    seasonId: v.id("seasons"),
    waiverType: v.union(v.literal("faab"), v.literal("priority")),
    faabBudget: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.seasonId, {
      waiverType: args.waiverType,
      ...(args.faabBudget !== undefined ? { faabBudget: args.faabBudget } : {}),
    });
  },
});
