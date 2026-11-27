import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { query, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { requireSeasonViewer } from "../lib/access";

export interface YoffsSeason {
  _id: Id<"seasons">;
  leagueId: Id<"leagues">;
  year: string;
  name: string;
  teamCount: number;
  scoring: Doc<"seasons">["scoring"];
  provider: "sleeper" | "yahoo" | "espn";
  isCommissioner: boolean;
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
    const add = (season: Doc<"seasons">, league: Doc<"leagues">, isCommissioner: boolean) => {
      if (seen.has(season._id)) return;
      const row = toYoffsSeason(season, league, isCommissioner);
      if (!row) return;
      seen.add(season._id);
      result.push(row);
    };

    const owned = await ctx.db
      .query("leagues")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    for (const league of owned) {
      for (const season of await leagueSeasons(ctx, league._id)) add(season, league, true);
    }
    const collaborations = await ctx.db
      .query("leagueCollaborators")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const { leagueId } of collaborations) {
      const league = await ctx.db.get(leagueId);
      if (!league) continue;
      for (const season of await leagueSeasons(ctx, league._id)) add(season, league, true);
    }
    const memberships = await ctx.db
      .query("leagueTeamMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const { seasonId } of memberships) {
      const season = await ctx.db.get(seasonId);
      const league = season ? await ctx.db.get(season.leagueId) : null;
      if (season && league) add(season, league, false);
    }
    const yoffsMemberships = await ctx.db
      .query("yoffsMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const { seasonId } of yoffsMemberships) {
      const season = await ctx.db.get(seasonId);
      const league = season ? await ctx.db.get(season.leagueId) : null;
      if (season && league) add(season, league, false);
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
