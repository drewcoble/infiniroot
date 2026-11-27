import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query, type MutationCtx, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { isLeagueAuthorized, requireSeasonOwner } from "../lib/access";

// infiniyoffs' league link: one link per season; whoever opens it picks a
// team nobody has claimed yet, or just watches. Claims live in yoffsMembers
// and only reach infiniyoffs - infinifaab's per-team links
// (infinileague/auction/invites.ts) still work alongside, and their
// members count as having claimed their team here.

const MAX_NAME = 40;

async function requireUserId(ctx: QueryCtx | MutationCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("You must be signed in.");
  return userId;
}

// What the commissioner sees for a person: their name, else their email.
async function displayName(ctx: QueryCtx, userId: Id<"users">): Promise<string> {
  const user = await ctx.db.get(userId);
  return user?.name?.trim() || user?.email || "Unknown";
}

async function activeInvite(ctx: QueryCtx, seasonId: Id<"seasons">) {
  const invites = await ctx.db
    .query("yoffsLeagueInvites")
    .withIndex("by_season", (q) => q.eq("seasonId", seasonId))
    .collect();
  return invites.find((invite) => invite.revokedAt === undefined) ?? null;
}

async function inviteByToken(ctx: QueryCtx, token: string) {
  const invite = await ctx.db
    .query("yoffsLeagueInvites")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique();
  if (!invite || invite.revokedAt !== undefined) {
    throw new Error("This invite link is no longer valid.");
  }
  return invite;
}

// Teams someone already runs: the commissioner's own team, infinifaab
// members' teams, and league-link claims.
async function claimedTeamIds(
  ctx: QueryCtx,
  seasonId: Id<"seasons">,
  teams: Doc<"seasonTeams">[],
): Promise<Set<Id<"seasonTeams">>> {
  const claimed = new Set<Id<"seasonTeams">>();
  for (const team of teams) if (team.isSelf) claimed.add(team._id);
  for (const team of teams) {
    const member = await ctx.db
      .query("leagueTeamMembers")
      .withIndex("by_team_user", (q) => q.eq("teamId", team._id))
      .first();
    if (member) claimed.add(team._id);
  }
  const members = await ctx.db
    .query("yoffsMembers")
    .withIndex("by_season", (q) => q.eq("seasonId", seasonId))
    .collect();
  for (const member of members) if (member.teamId) claimed.add(member.teamId);
  return claimed;
}

async function seasonTeams(ctx: QueryCtx, seasonId: Id<"seasons">) {
  return await ctx.db
    .query("seasonTeams")
    .withIndex("by_season", (q) => q.eq("seasonId", seasonId))
    .collect();
}

// ---------------------------------------------------------------- commissioner

// The active link's token, or null when it's off.
export const getLeagueInvite = query({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args): Promise<string | null> => {
    await requireSeasonOwner(ctx, args.seasonId);
    return (await activeInvite(ctx, args.seasonId))?.token ?? null;
  },
});

// A new link - the old one stops working.
export const createLeagueInvite = mutation({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args): Promise<string> => {
    const userId = await requireUserId(ctx);
    await requireSeasonOwner(ctx, args.seasonId);
    const old = await activeInvite(ctx, args.seasonId);
    if (old) await ctx.db.patch(old._id, { revokedAt: Date.now() });
    const token = crypto.randomUUID();
    await ctx.db.insert("yoffsLeagueInvites", {
      seasonId: args.seasonId,
      token,
      createdByUserId: userId,
      createdAt: Date.now(),
    });
    return token;
  },
});

export const revokeLeagueInvite = mutation({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args): Promise<void> => {
    await requireSeasonOwner(ctx, args.seasonId);
    const old = await activeInvite(ctx, args.seasonId);
    if (old) await ctx.db.patch(old._id, { revokedAt: Date.now() });
  },
});

export interface YoffsMemberRow {
  userId: Id<"users">;
  name: string;
  // Null = watching.
  teamId: Id<"seasonTeams"> | null;
  // "link": joined through the league link (removable here); "team":
  // through infinifaab's per-team link.
  via: "link" | "team";
}

// Everyone who joined, for the commissioner's members list.
export const listMembers = query({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args): Promise<YoffsMemberRow[]> => {
    await requireSeasonOwner(ctx, args.seasonId);
    const rows: YoffsMemberRow[] = [];
    const links = await ctx.db
      .query("yoffsMembers")
      .withIndex("by_season", (q) => q.eq("seasonId", args.seasonId))
      .collect();
    for (const member of links) {
      rows.push({
        userId: member.userId,
        name: await displayName(ctx, member.userId),
        teamId: member.teamId ?? null,
        via: "link",
      });
    }
    for (const team of await seasonTeams(ctx, args.seasonId)) {
      const members = await ctx.db
        .query("leagueTeamMembers")
        .withIndex("by_team_user", (q) => q.eq("teamId", team._id))
        .collect();
      for (const member of members) {
        rows.push({
          userId: member.userId,
          name: await displayName(ctx, member.userId),
          teamId: team._id,
          via: "team",
        });
      }
    }
    return rows;
  },
});

// Moves a league-link member to a team (any team - the commissioner can
// add a co-owner) or to watching.
export const setMemberTeam = mutation({
  args: {
    seasonId: v.id("seasons"),
    userId: v.id("users"),
    teamId: v.union(v.id("seasonTeams"), v.null()),
  },
  handler: async (ctx, args): Promise<void> => {
    await requireSeasonOwner(ctx, args.seasonId);
    const member = await ctx.db
      .query("yoffsMembers")
      .withIndex("by_season_user", (q) =>
        q.eq("seasonId", args.seasonId).eq("userId", args.userId),
      )
      .unique();
    if (!member) throw new Error("That person isn't a member.");
    if (args.teamId) {
      const team = await ctx.db.get(args.teamId);
      if (team?.seasonId !== args.seasonId) throw new Error("That team isn't in this league.");
    }
    await ctx.db.patch(member._id, { teamId: args.teamId ?? undefined });
  },
});

export const removeMember = mutation({
  args: { seasonId: v.id("seasons"), userId: v.id("users") },
  handler: async (ctx, args): Promise<void> => {
    await requireSeasonOwner(ctx, args.seasonId);
    const member = await ctx.db
      .query("yoffsMembers")
      .withIndex("by_season_user", (q) =>
        q.eq("seasonId", args.seasonId).eq("userId", args.userId),
      )
      .unique();
    if (member) await ctx.db.delete(member._id);
  },
});

// ---------------------------------------------------------------- joining

export interface JoinInfo {
  seasonId: Id<"seasons">;
  leagueName: string;
  // Already in (commissioner or member) - the page just goes to the league.
  alreadyIn: boolean;
  // No name on the account yet - the join form asks for one.
  needsName: boolean;
  teams: { teamId: Id<"seasonTeams">; name: string; logoUrl: string | null; claimed: boolean }[];
}

// What the join page shows for a link: the league and which teams are
// still open. Null for a dead link.
export const getJoinInfo = query({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<JoinInfo | null> => {
    const userId = await requireUserId(ctx);
    const invite = await ctx.db
      .query("yoffsLeagueInvites")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!invite || invite.revokedAt !== undefined) return null;
    const season = await ctx.db.get(invite.seasonId);
    const league = season ? await ctx.db.get(season.leagueId) : null;
    if (!season || !league) return null;
    const user = await ctx.db.get(userId);

    const member = await ctx.db
      .query("yoffsMembers")
      .withIndex("by_season_user", (q) => q.eq("seasonId", season._id).eq("userId", userId))
      .unique();
    const teamMember = await ctx.db
      .query("leagueTeamMembers")
      .withIndex("by_season_user", (q) => q.eq("seasonId", season._id).eq("userId", userId))
      .first();
    const alreadyIn =
      member !== null || teamMember !== null || (await isLeagueAuthorized(ctx, league, userId));

    const teams = await seasonTeams(ctx, season._id);
    const claimed = await claimedTeamIds(ctx, season._id, teams);
    return {
      seasonId: season._id,
      leagueName: league.name,
      alreadyIn,
      needsName: !user?.name?.trim(),
      teams: teams
        .map((team) => ({
          teamId: team._id,
          name: team.name,
          logoUrl: team.logoUrl ?? null,
          claimed: claimed.has(team._id),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  },
});

// Joins through the league link: an open team, or null to watch. Saves
// the caller's name first when given (accounts made before sign-up kept it).
export const joinLeague = mutation({
  args: {
    token: v.string(),
    teamId: v.union(v.id("seasonTeams"), v.null()),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ seasonId: Id<"seasons"> }> => {
    const userId = await requireUserId(ctx);
    const invite = await inviteByToken(ctx, args.token);
    const seasonId = invite.seasonId;
    if (args.name !== undefined) await saveName(ctx, userId, args.name);

    if (args.teamId) {
      const team = await ctx.db.get(args.teamId);
      if (team?.seasonId !== seasonId) throw new Error("That team isn't in this league.");
      const claimed = await claimedTeamIds(ctx, seasonId, await seasonTeams(ctx, seasonId));
      if (claimed.has(args.teamId)) {
        throw new Error("Someone already claimed that team - ask the commissioner.");
      }
    }
    const member = await ctx.db
      .query("yoffsMembers")
      .withIndex("by_season_user", (q) => q.eq("seasonId", seasonId).eq("userId", userId))
      .unique();
    if (member) await ctx.db.patch(member._id, { teamId: args.teamId ?? undefined });
    else {
      await ctx.db.insert("yoffsMembers", {
        seasonId,
        userId,
        ...(args.teamId ? { teamId: args.teamId } : {}),
        joinedAt: Date.now(),
      });
    }
    return { seasonId };
  },
});

async function saveName(ctx: MutationCtx, userId: Id<"users">, raw: string) {
  const name = raw.trim().slice(0, MAX_NAME);
  if (!name) throw new Error("Enter your name.");
  await ctx.db.patch(userId, { name });
  const profile = await ctx.db
    .query("userProfiles")
    .withIndex("by_user_id", (q) => q.eq("userId", userId))
    .unique();
  if (profile) await ctx.db.patch(profile._id, { name });
}
