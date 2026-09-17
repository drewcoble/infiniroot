import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "../../_generated/server";
import { requireLeagueOwner } from "../../lib/access";
import type { Id } from "../../_generated/dataModel";

// infinidraft's "invite a co-manager" feature - first pass at multi-user
// access, modeled after infinileague/auction/invites.ts's per-team invite
// flow but scoped to the whole league instead of one team (see schema.ts's
// leagueInvites/leagueCollaborators comments for why: a draft co-manager
// more plausibly means "full owner-equivalent access to this league" than
// "access to one specific team"). Deliberately just one invite
// action for now, not per-team-member self-service bidding - see the
// leagueCollaborators schema comment.

// Current sharing state for one league (its active invite link, if any, and
// who's already redeemed one) - owner-only (requireLeagueOwner), powers the
// Settings "Invite a co-manager" card (src/pages/Settings/components/
// SharingPanel.tsx).
export const getLeagueSharing = query({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args) => {
    const { league } = await requireLeagueOwner(ctx, args.seasonId);

    const invite = await ctx.db
      .query("leagueInvites")
      .withIndex("by_league", (q) => q.eq("leagueId", league._id))
      .filter((q) => q.eq(q.field("revokedAt"), undefined))
      .first();

    const collaborators = await ctx.db
      .query("leagueCollaborators")
      .withIndex("by_league", (q) => q.eq("leagueId", league._id))
      .collect();
    const collaboratorRows = await Promise.all(
      collaborators.map(async (collaborator) => {
        const profile = await ctx.db
          .query("userProfiles")
          .withIndex("by_user_id", (q) => q.eq("userId", collaborator.userId))
          .first();
        return {
          _id: collaborator._id,
          userId: collaborator.userId,
          joinedAt: collaborator.joinedAt,
          name: profile?.name ?? null,
          email: profile?.email ?? null,
        };
      }),
    );

    return {
      token: invite?.token ?? null,
      collaborators: collaboratorRows,
    };
  },
});

// Generates a fresh invite link for this league, revoking any prior active
// one first (see leagueInvites' schema comment for why regenerate revokes
// rather than mutates the token in place). Owner-only.
export const createLeagueInvite = mutation({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args) => {
    const { league } = await requireLeagueOwner(ctx, args.seasonId);
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("You must be signed in.");
    }

    const now = Date.now();
    const activeInvites = await ctx.db
      .query("leagueInvites")
      .withIndex("by_league", (q) => q.eq("leagueId", league._id))
      .filter((q) => q.eq(q.field("revokedAt"), undefined))
      .collect();
    for (const row of activeInvites) {
      await ctx.db.patch(row._id, { revokedAt: now });
    }

    const token = crypto.randomUUID();
    await ctx.db.insert("leagueInvites", {
      leagueId: league._id,
      token,
      createdByUserId: userId,
      createdAt: now,
    });
    return token;
  },
});

// Kills this league's active invite link without generating a new one -
// owner-only.
export const revokeLeagueInvite = mutation({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args) => {
    const { league } = await requireLeagueOwner(ctx, args.seasonId);
    const now = Date.now();
    const activeInvites = await ctx.db
      .query("leagueInvites")
      .withIndex("by_league", (q) => q.eq("leagueId", league._id))
      .filter((q) => q.eq(q.field("revokedAt"), undefined))
      .collect();
    for (const row of activeInvites) {
      await ctx.db.patch(row._id, { revokedAt: now });
    }
    return null;
  },
});

// Revokes one co-manager's access to this league - owner-only. Doesn't
// touch the invite link itself, so the same link can be redeemed again
// (by this or a different person) unless separately revoked.
export const removeCollaborator = mutation({
  args: {
    seasonId: v.id("seasons"),
    collaboratorId: v.id("leagueCollaborators"),
  },
  handler: async (ctx, args) => {
    const { league } = await requireLeagueOwner(ctx, args.seasonId);
    const collaborator = await ctx.db.get(args.collaboratorId);
    if (!collaborator || collaborator.leagueId !== league._id) {
      throw new Error("Collaborator not found.");
    }
    await ctx.db.delete(args.collaboratorId);
    return null;
  },
});

// Redeems an invite token - any signed-in user, no owner check (holding the
// token is the authorization, same convention as infinileague/auction/
// invites.ts's redeemTeamInvite). Idempotent: redeeming an already-redeemed
// link, or the owner redeeming their own link, is a no-op rather than a
// duplicate row/error. Returns the league's most recent season so the join
// page can navigate straight into it.
export const redeemLeagueInvite = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("You must be signed in.");
    }

    const invite = await ctx.db
      .query("leagueInvites")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!invite || invite.revokedAt !== undefined) {
      throw new Error("This invite link is no longer valid.");
    }
    const league = await ctx.db.get(invite.leagueId);
    if (!league) {
      throw new Error("League not found.");
    }

    if (league.ownerId !== userId) {
      const existing = await ctx.db
        .query("leagueCollaborators")
        .withIndex("by_league_user", (q) =>
          q.eq("leagueId", league._id).eq("userId", userId),
        )
        .unique();
      if (!existing) {
        await ctx.db.insert("leagueCollaborators", {
          leagueId: league._id,
          userId,
          invitedByUserId: invite.createdByUserId,
          joinedAt: Date.now(),
        });
      }
    }

    const seasons = await ctx.db
      .query("seasons")
      .withIndex("by_league", (q) => q.eq("leagueId", league._id))
      .collect();
    const latestSeason = seasons.reduce<
      (typeof seasons)[number] | null
    >((latest, season) => {
      if (!latest || season.year > latest.year) return season;
      return latest;
    }, null);
    if (!latestSeason) {
      throw new Error("This league has no seasons yet.");
    }

    return { seasonId: latestSeason._id as Id<"seasons"> };
  },
});
