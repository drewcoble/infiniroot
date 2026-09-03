import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalQuery, query } from "../../_generated/server";
import { Doc, Id } from "../../_generated/dataModel";
import { requireSeasonOwner } from "../../lib/access";

// Team-scoped counterpart to convex/rosterSync.ts's
// requireOwnedSeasonForSync - for this file's own getTeamRosterForWeek
// (convex/infinileague/season/teamRoster.ts), which only has a teamId (not
// a seasonId) and, being an action, can't call the QueryCtx/MutationCtx-
// typed requireSeasonOwner directly either.
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

// Fallback data source for convex/infinileague/season/teamRoster.ts's
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

// "When did each team's roster last get refreshed from its linked
// provider" - nothing before this read syncedAt back at all
// (convex/sleeper/league.ts's syncLeagueRoster and convex/rosterSync.ts's
// replaceRosterForTeam only ever write it; infinidraft's own UI shows just
// a transient "Synced N teams" toast right after a manual sync, never a
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
