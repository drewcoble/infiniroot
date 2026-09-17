import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc } from "../../_generated/dataModel";
import { requireSeasonOwner } from "../../lib/access";

// infinifaab's invite/membership backend - the mechanism by which a real
// person other than the league's commissioner gets any access at all (see
// convex/lib/access.ts's requireSeasonParticipant/requireTeamAccess, which
// read the leagueTeamMembers rows this file writes). Commissioner-only
// (requireSeasonOwner) except redeemTeamInvite itself, which anyone holding
// the link can call - same trust model as any other invite-link feature.

export interface TeamInviteRow {
  teamId: Doc<"seasonTeams">["_id"];
  teamName: string;
  token: string | null;
  members: Array<{ userId: Doc<"users">["_id"]; name: string | null }>;
}

// One row per team in the season - the commissioner's Settings-tab view of
// who's been invited/joined where. token is null once revoked (and not yet
// regenerated), so the UI can tell "never invited" apart from "invited, no
// active link right now."
export const listTeamInvites = query({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args): Promise<TeamInviteRow[]> => {
    await requireSeasonOwner(ctx, args.seasonId);
    const teams = await ctx.db
      .query("seasonTeams")
      .withIndex("by_season", (q) => q.eq("seasonId", args.seasonId))
      .collect();

    const result: TeamInviteRow[] = [];
    for (const team of teams) {
      const invites = await ctx.db
        .query("leagueTeamInvites")
        .withIndex("by_team", (q) => q.eq("teamId", team._id))
        .collect();
      const activeInvite = invites.find((i) => i.revokedAt === undefined);

      const memberships = await ctx.db
        .query("leagueTeamMembers")
        .withIndex("by_team_user", (q) => q.eq("teamId", team._id))
        .collect();
      const members = [];
      for (const membership of memberships) {
        const user = await ctx.db.get(membership.userId);
        members.push({ userId: membership.userId, name: user?.name ?? null });
      }

      result.push({
        teamId: team._id,
        teamName: team.name,
        token: activeInvite?.token ?? null,
        members,
      });
    }
    return result;
  },
});

// Regenerating an invite revokes any existing active one for this team
// first - see schema.ts's leagueTeamInvites comment for why (an old,
// already-shared link should visibly stop working, not silently start
// pointing somewhere new).
export const createTeamInvite = mutation({
  args: { seasonId: v.id("seasons"), teamId: v.id("seasonTeams") },
  handler: async (ctx, args): Promise<string> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("You must be signed in.");
    }
    await requireSeasonOwner(ctx, args.seasonId);

    const existingInvites = await ctx.db
      .query("leagueTeamInvites")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .collect();
    for (const invite of existingInvites) {
      if (invite.revokedAt === undefined) {
        await ctx.db.patch(invite._id, { revokedAt: Date.now() });
      }
    }

    const token = crypto.randomUUID();
    await ctx.db.insert("leagueTeamInvites", {
      seasonId: args.seasonId,
      teamId: args.teamId,
      token,
      createdByUserId: userId,
      createdAt: Date.now(),
    });
    return token;
  },
});

export const revokeTeamInvite = mutation({
  args: { seasonId: v.id("seasons"), teamId: v.id("seasonTeams") },
  handler: async (ctx, args): Promise<void> => {
    await requireSeasonOwner(ctx, args.seasonId);
    const existingInvites = await ctx.db
      .query("leagueTeamInvites")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .collect();
    for (const invite of existingInvites) {
      if (invite.revokedAt === undefined) {
        await ctx.db.patch(invite._id, { revokedAt: Date.now() });
      }
    }
  },
});

export const removeTeamMember = mutation({
  args: {
    seasonId: v.id("seasons"),
    teamId: v.id("seasonTeams"),
    userId: v.id("users"),
  },
  handler: async (ctx, args): Promise<void> => {
    await requireSeasonOwner(ctx, args.seasonId);
    const membership = await ctx.db
      .query("leagueTeamMembers")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", args.teamId).eq("userId", args.userId),
      )
      .unique();
    if (membership) {
      await ctx.db.delete(membership._id);
    }
  },
});

// No ownership check beyond "you're signed in" - holding the token IS the
// authorization, same trust model as a real invite link. Idempotent: an
// already-a-member user redeeming the same link again is a no-op, not an
// error (e.g. they open the link a second time on another device).
export const redeemTeamInvite = mutation({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<{ seasonId: Doc<"seasons">["_id"] }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("You must be signed in.");
    }
    const invite = await ctx.db
      .query("leagueTeamInvites")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!invite || invite.revokedAt !== undefined) {
      throw new Error("This invite link is no longer valid.");
    }

    const existingMembership = await ctx.db
      .query("leagueTeamMembers")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", invite.teamId).eq("userId", userId),
      )
      .unique();
    if (!existingMembership) {
      await ctx.db.insert("leagueTeamMembers", {
        seasonId: invite.seasonId,
        teamId: invite.teamId,
        userId,
        joinedAt: Date.now(),
      });
    }

    return { seasonId: invite.seasonId };
  },
});
