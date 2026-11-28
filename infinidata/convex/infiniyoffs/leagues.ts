import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { requireSeasonOwner, requireSeasonViewer } from "../lib/access";
import { resolveLeagueType } from "../leagueType";

export interface YoffsSeason {
  _id: Id<"seasons">;
  leagueId: Id<"leagues">;
  year: string;
  name: string;
  teamCount: number;
  scoring: Doc<"seasons">["scoring"];
  provider: "sleeper" | "yahoo" | "espn";
  isCommissioner: boolean;
  // Put on infiniyoffs by its commissioner (see inYoffs below) - the home
  // screen lists these, and offers the commissioner's others to connect.
  inYoffs: boolean;
}

// The commissioner's say, else on if it has custom rules or anyone joined
// through its league link.
async function seasonInYoffs(
  ctx: QueryCtx,
  seasonId: Id<"seasons">,
  joinedHere: boolean,
): Promise<boolean> {
  const settings = await ctx.db
    .query("playoffSettings")
    .withIndex("by_season", (q) => q.eq("seasonId", seasonId))
    .unique();
  return settings?.inYoffs ?? (joinedHere || settings?.format !== undefined);
}

function provider(season: Doc<"seasons">): YoffsSeason["provider"] | null {
  if (season.sleeperLeagueId !== undefined) return "sleeper";
  if (season.yahooLeagueKey !== undefined) return "yahoo";
  if (season.espnLeagueId !== undefined) return "espn";
  return null;
}

function toYoffsSeason(
  season: Doc<"seasons">,
  league: Doc<"leagues">,
  isCommissioner: boolean,
  inYoffs: boolean,
): YoffsSeason | null {
  const linked = provider(season);
  if (linked === null) return null;
  return {
    _id: season._id,
    leagueId: league._id,
    year: season.year,
    name: league.name,
    teamCount: season.teamCount,
    scoring: season.scoring,
    provider: linked,
    isCommissioner,
    inYoffs,
  };
}

async function leagueSeasons(ctx: QueryCtx, leagueId: Id<"leagues">) {
  return await ctx.db
    .query("seasons")
    .withIndex("by_league_year", (q) => q.eq("leagueId", leagueId))
    .collect();
}

// infiniyoffs' dashboard and league switcher: every provider-linked season
// the caller commissions (owner or co-manager), holds a team membership
// in, or joined through the league link - the same people
// requireSeasonViewer lets in.
export const listMySeasons = query({
  args: {},
  handler: async (ctx): Promise<YoffsSeason[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("You must be signed in.");
    }
    const result: YoffsSeason[] = [];
    const seen = new Set<Id<"seasons">>();
    // A member only sees leagues on infiniyoffs; the commissioner sees all
    // of theirs, to connect the rest. joinedHere: through the league link.
    const add = async (
      season: Doc<"seasons">,
      league: Doc<"leagues">,
      isCommissioner: boolean,
      joinedHere = false,
    ) => {
      if (seen.has(season._id)) return;
      const inYoffs = await seasonInYoffs(ctx, season._id, joinedHere);
      if (!isCommissioner && !inYoffs) return;
      // A guillotine league has no playoffs to customize - never offered.
      if (!inYoffs && resolveLeagueType(season) === "guillotine") return;
      const row = toYoffsSeason(season, league, isCommissioner, inYoffs);
      if (!row) return;
      seen.add(season._id);
      result.push(row);
    };

    const owned = await ctx.db
      .query("leagues")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    for (const league of owned) {
      for (const season of await leagueSeasons(ctx, league._id)) await add(season, league, true);
    }
    const collaborations = await ctx.db
      .query("leagueCollaborators")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const { leagueId } of collaborations) {
      const league = await ctx.db.get(leagueId);
      if (!league) continue;
      for (const season of await leagueSeasons(ctx, league._id)) await add(season, league, true);
    }
    const memberships = await ctx.db
      .query("leagueTeamMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const { seasonId } of memberships) {
      const season = await ctx.db.get(seasonId);
      const league = season ? await ctx.db.get(season.leagueId) : null;
      if (season && league) await add(season, league, false);
    }
    const yoffsMemberships = await ctx.db
      .query("yoffsMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const { seasonId } of yoffsMemberships) {
      const season = await ctx.db.get(seasonId);
      const league = season ? await ctx.db.get(season.leagueId) : null;
      if (season && league) await add(season, league, false, true);
    }
    return result;
  },
});

export interface YoffsViewer {
  isCommissioner: boolean;
  teamIds: Id<"seasonTeams">[];
}

// "Who am I in this league" - gates the commissioner-only controls
// (rules, invites, drafting for another team) and highlights my team.
export const getMyViewer = query({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args): Promise<YoffsViewer> => {
    const { isCommissioner, teamIds } = await requireSeasonViewer(ctx, args.seasonId);
    return { isCommissioner, teamIds };
  },
});

// Commissioner only: puts the league on infiniyoffs or takes it off (its
// rules and groups are kept either way). Never a guillotine league.
export const setInYoffs = mutation({
  args: { seasonId: v.id("seasons"), inYoffs: v.boolean() },
  handler: async (ctx, args): Promise<void> => {
    const { season } = await requireSeasonOwner(ctx, args.seasonId);
    if (args.inYoffs && resolveLeagueType(season) === "guillotine") {
      throw new Error("Guillotine leagues don't have playoffs to customize.");
    }
    const settings = await ctx.db
      .query("playoffSettings")
      .withIndex("by_season", (q) => q.eq("seasonId", args.seasonId))
      .unique();
    if (settings) await ctx.db.patch(settings._id, { inYoffs: args.inYoffs });
    else await ctx.db.insert("playoffSettings", { seasonId: args.seasonId, inYoffs: args.inYoffs });
  },
});
