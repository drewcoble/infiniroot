import { v } from "convex/values";
import { action, ActionCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { Id } from "../../_generated/dataModel";
import { fetchSleeperJson } from "../../sleeper/league";
import { fetchYahooOpponentTeamKey } from "../../infinidraft/yahoo/league";
import { withYahooToken } from "../../infinidraft/yahoo/oauth";
import type { SleeperMatchupEntry } from "./teamRoster";

// Who a team is playing this week - Sleeper-linked teams resolve it from
// matchup_id (Sleeper groups exactly two roster_ids under the same
// matchup_id per week - documented behavior); Yahoo-linked teams resolve it
// from the league's scoreboard resource (see fetchYahooOpponentTeamKey,
// NOT confirmed against a live response - see YAHOO.md). Unlinked teams, or
// either provider's genuine bye week (an odd team count leaves one roster
// with no matchup some weeks), just get opponentTeamId: null - the Matchup
// tab falls back to letting the viewer pick an opponent manually then.
export const getOpponentForWeek = action({
  args: { teamId: v.id("seasonTeams"), week: v.string() },
  handler: async (ctx: ActionCtx, args): Promise<{ opponentTeamId: Id<"seasonTeams"> | null }> => {
    const { team, season, league } = await ctx.runQuery(
      internal.infinileague.season.rosterPlayers.requireOwnedTeamForRead,
      { teamId: args.teamId },
    );

    if (team.sleeperRosterId && season.sleeperLeagueId) {
      const matchups = await fetchSleeperJson<SleeperMatchupEntry[]>(
        `/league/${season.sleeperLeagueId}/matchups/${args.week}`,
      );
      const selfEntry = matchups.find((m) => String(m.roster_id) === team.sleeperRosterId);
      if (!selfEntry || selfEntry.matchup_id === null || selfEntry.matchup_id === undefined) {
        return { opponentTeamId: null };
      }
      const opponentEntry = matchups.find(
        (m) => m.matchup_id === selfEntry.matchup_id && String(m.roster_id) !== team.sleeperRosterId,
      );
      if (!opponentEntry) {
        return { opponentTeamId: null };
      }

      const teams = await ctx.runQuery(internal.seasonTeams.listSeasonTeamsInternal, {
        seasonId: team.seasonId,
      });
      const opponentTeam = teams.find(
        (t) => t.sleeperRosterId === String(opponentEntry.roster_id),
      );
      return { opponentTeamId: opponentTeam?._id ?? null };
    }

    if (team.yahooTeamKey && season.yahooLeagueKey) {
      const opponentTeamKey = await withYahooToken(ctx, league.ownerId, (accessToken) =>
        fetchYahooOpponentTeamKey(accessToken, season.yahooLeagueKey!, args.week, team.yahooTeamKey!),
      );
      if (opponentTeamKey === null) {
        return { opponentTeamId: null };
      }
      const teams = await ctx.runQuery(internal.seasonTeams.listSeasonTeamsInternal, {
        seasonId: team.seasonId,
      });
      const opponentTeam = teams.find((t) => t.yahooTeamKey === opponentTeamKey);
      return { opponentTeamId: opponentTeam?._id ?? null };
    }

    return { opponentTeamId: null };
  },
});
