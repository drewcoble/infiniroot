import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, internalQuery, query } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";
import { requireSeasonOwner } from "../draft/auth";

// Shared by both provider syncs (convex/sleeper/league.ts's syncLeagueRoster
// and convex/yahoo/league.ts's syncYahooLeagueRoster) - both need "confirm
// the caller owns this season" (via its league) before touching its
// rosterPlayers/faabSpent, and neither check has anything provider-specific
// about it. Returns the league too since syncYahooLeagueRoster needs
// league.ownerId to look up the Yahoo token (Yahoo connections are per-app-
// user, not per-season).
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

// Team-scoped counterpart to requireOwnedSeasonForSync - for
// convex/season/teamRoster.ts's getTeamRosterForWeek, which only has a
// teamId (not a seasonId) and, being an action, can't call the
// QueryCtx/MutationCtx-typed requireSeasonOwner directly either.
export const requireOwnedTeamForRead = internalQuery({
  args: { teamId: v.id("seasonTeams") },
  handler: async (
    ctx,
    args,
  ): Promise<{ team: Doc<"seasonTeams">; season: Doc<"seasons"> }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("You must be signed in.");
    }
    const team = await ctx.db.get(args.teamId);
    if (!team) {
      throw new Error("Team not found.");
    }
    const season = await ctx.db.get(team.seasonId);
    if (!season) {
      throw new Error("Season not found.");
    }
    const league = await ctx.db.get(season.leagueId);
    if (!league) {
      throw new Error("League not found.");
    }
    if (league.ownerId !== userId) {
      throw new Error("Not authorized to view this team.");
    }
    return { team, season };
  },
});

// Fallback data source for convex/season/teamRoster.ts's
// getTeamRosterForWeek, when a team isn't Sleeper-linked (no per-week
// matchup data available at all) - the current synced roster.
export const listRosterFpidsForTeam = internalQuery({
  args: { teamId: v.id("seasonTeams") },
  handler: async (ctx, args): Promise<number[]> => {
    const rows = await ctx.db
      .query("rosterPlayers")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .collect();
    return rows.map((row) => row.fpid);
  },
});

// Shared write path for both provider syncs (convex/sleeper/league.ts's
// syncLeagueRoster and convex/yahoo/league.ts's syncYahooLeagueRoster) -
// replace-all-on-sync for one team's roster. See schema.ts's rosterPlayers
// comment for why this table (and this mutation) is provider-agnostic.
export const replaceRosterForTeam = internalMutation({
  args: {
    seasonId: v.id("seasons"),
    teamId: v.id("seasonTeams"),
    fpids: v.array(v.number()),
    faabSpent: v.number(),
    // Current-season standings, synced alongside the roster itself - see
    // convex/season/standings.ts and schema.ts's seasonTeams comment.
    // waiverPosition is genuinely absent for a FAAB league (not just 0),
    // so it stays optional; the others always come back from Sleeper.
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

// infinileague-facing: "when did each team's roster last get refreshed from
// its linked provider" - nothing before this read syncedAt back at all
// (convex/sleeper/league.ts's syncLeagueRoster and this file's own
// replaceRosterForTeam only ever write it; infinidraft's own UI shows just a
// transient "Synced N teams" toast right after a manual sync, never a
// persisted timestamp). infinileague needs this to decide whether a
// league's roster data is stale enough to warrant an automatic re-sync (see
// convex/sleeper/league.ts's syncLeagueRoster) and to show a "Last synced"
// readout. Every rosterPlayers row for one team shares the same syncedAt
// (replace-all-on-sync writes them all in the same handler call), so the
// max-per-team here is defensive rather than something that actually
// branches in practice.
export const getRosterSyncStatus = query({
  args: { seasonId: v.id("seasons") },
  handler: async (
    ctx,
    args,
  ): Promise<Array<{ teamId: Id<"seasonTeams">; syncedAt: number }>> => {
    await requireSeasonOwner(ctx, args.seasonId);
    const rows = await ctx.db
      .query("rosterPlayers")
      .withIndex("by_season", (q) => q.eq("seasonId", args.seasonId))
      .collect();
    const byTeam = new Map<Id<"seasonTeams">, number>();
    for (const row of rows) {
      const existing = byTeam.get(row.teamId);
      if (existing === undefined || row.syncedAt > existing) {
        byTeam.set(row.teamId, row.syncedAt);
      }
    }
    return Array.from(byTeam, ([teamId, syncedAt]) => ({ teamId, syncedAt }));
  },
});
