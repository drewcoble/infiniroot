import { internalAction, internalQuery } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Doc } from "../../_generated/dataModel";

// Every season with the auction feature turned on - the frequent waiver-
// refresh cron (convex/crons.ts) is a no-op for every other league.
export const listEnabledAuctionSeasons = internalQuery({
  args: {},
  handler: async (ctx): Promise<Doc<"seasons">[]> => {
    const settingsRows = await ctx.db.query("faAuctionSettings").collect();
    const seasons: Doc<"seasons">[] = [];
    for (const settings of settingsRows) {
      if (!settings.enabled) continue;
      const season = await ctx.db.get(settings.seasonId);
      if (season) seasons.push(season);
    }
    return seasons;
  },
});

// Routes each enabled season to its own provider's waiver sync. Sleeper is
// deliberately NOT called here - eligibility.ts's getEligibleFpidSet computes
// Sleeper eligibility directly from rosterPlayers now (real-world testing
// showed the drop-transaction-derived waiverPlayers rows convex/sleeper/
// transactions.ts produces missed most of a real waiver pool - see that
// eligibility.ts comment), so syncing them would just burn Sleeper/Tank01
// API calls for a table nothing reads on the Sleeper path anymore. That
// sync is parked, not deleted, in case a future need brings it back.
// Best-effort per season: one league's provider hiccup (rate limit,
// expired Yahoo token, etc) shouldn't block every other league's refresh
// in the same cron tick.
export const refreshAllSeasons = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const seasons = await ctx.runQuery(
      internal.infinileague.auction.waiverSync.listEnabledAuctionSeasons,
      {},
    );
    for (const season of seasons) {
      if (!season.yahooLeagueKey) continue;
      try {
        await ctx.runAction(internal.infinidraft.yahoo.waivers.syncYahooWaiverPlayers, {
          seasonId: season._id,
        });
      } catch (err) {
        console.error(`Waiver refresh failed for season ${season._id}:`, err);
      }
    }
  },
});
