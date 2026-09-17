import { v } from "convex/values";
import { internalAction, internalQuery } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Doc } from "../../_generated/dataModel";
import { fetchYahooApi, findNodesByKey } from "./client";
import { withYahooToken } from "./oauth";
import { extractRosterPlayers } from "./league";

/**
 * Yahoo's own API can filter its players resource directly to the current
 * waiver pool (`;status=W`) - unlike Sleeper, no drop-time/settings
 * derivation needed here, see AUCTION_PLAN's "Waiver-eligibility data"
 * section. Just a periodic poll: whatever's returned right now IS the
 * eligible set, so this is a plain replace-all-on-sync with no computed
 * clearsAt (see schema.ts's waiverPlayers.clearsAt comment).
 *
 * NOT verified against a live response (see YAHOO.md - this repo's whole
 * Yahoo integration carries that caveat until real API access is
 * available). Only fetches the first page (Yahoo paginates players in
 * chunks, typically 25) - a league with a waiver pool larger than one page
 * will undercount until pagination is added here.
 */
const WAIVER_PLAYERS_PATH_SUFFIX = "/players;status=W";

// No auth check - only ever called from our own cron-triggered orchestrator
// (convex/infinileague/auction/waiverSync.ts), never exposed publicly.
export const getSeasonAndOwnerForWaiverSync = internalQuery({
  args: { seasonId: v.id("seasons") },
  handler: async (
    ctx,
    args,
  ): Promise<{ season: Doc<"seasons">; league: Doc<"leagues"> } | null> => {
    const season = await ctx.db.get(args.seasonId);
    if (!season) return null;
    const league = await ctx.db.get(season.leagueId);
    if (!league) return null;
    return { season, league };
  },
});

export const syncYahooWaiverPlayers = internalAction({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args): Promise<{ upserted: number }> => {
    const result = await ctx.runQuery(
      internal.infinidraft.yahoo.waivers.getSeasonAndOwnerForWaiverSync,
      { seasonId: args.seasonId },
    );
    if (!result || !result.season.yahooLeagueKey) {
      return { upserted: 0 };
    }
    const { season, league } = result;

    const rows = await withYahooToken(ctx, league.ownerId, async (accessToken) => {
      const json = await fetchYahooApi<unknown>(
        accessToken,
        `/league/${season.yahooLeagueKey}${WAIVER_PLAYERS_PATH_SUFFIX}`,
      );
      const waiverPlayers = extractRosterPlayers(findNodesByKey(json, "player"));
      const fpids: number[] = await ctx.runQuery(
        internal.infinidraft.yahoo.league.resolveFpidsByName,
        { players: waiverPlayers },
      );
      return fpids.map((fpid) => ({ fpid }));
    });

    await ctx.runMutation(
      internal.infinileague.auction.waiverPlayersData.replaceWaiverPlayersForSeason,
      { seasonId: args.seasonId, rows },
    );
    return { upserted: rows.length };
  },
});
