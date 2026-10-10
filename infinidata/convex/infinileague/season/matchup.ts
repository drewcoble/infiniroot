import { v } from "convex/values";
import { action, ActionCtx, query } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { Id } from "../../_generated/dataModel";
import { fetchSleeperJson } from "../../sleeper/league";
import { fetchYahooOpponentTeamKey } from "../../infinidraft/yahoo/league";
import { withYahooToken } from "../../infinidraft/yahoo/oauth";
import type { SleeperMatchupEntry } from "./teamRoster";
import { requireSeasonOwner } from "../../lib/access";
import { loadWeekPoints } from "../../lib/weekPoints";

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

// Each player's position rank by points actually scored this week (this
// season's scoring), among everyone at the position who has played - the
// Matchup tab's position badges ("RB3") once a game kicks off. Reads the
// same live/daily points getWeekPoints does, so it re-ranks on every
// 2-minute live poll. Ties share a rank (12.4, 12.4, 11.0 -> 5, 5, 7).
// Players with no entry yet haven't played and get no rank.
export const getWeekPositionRanks = query({
  args: { seasonId: v.id("seasons"), week: v.string() },
  handler: async (ctx, args): Promise<Array<{ fpid: number; rank: number }>> => {
    await requireSeasonOwner(ctx, args.seasonId);
    const entries = await loadWeekPoints(ctx, args.seasonId, args.week);

    const byPosition = new Map<string, typeof entries>();
    for (const entry of entries) {
      const list = byPosition.get(entry.position) ?? [];
      list.push(entry);
      byPosition.set(entry.position, list);
    }

    const ranks: Array<{ fpid: number; rank: number }> = [];
    for (const list of byPosition.values()) {
      list.sort((a, b) => b.points - a.points);
      list.forEach((entry, index) => {
        const tiedWithPrevious = index > 0 && entry.points === list[index - 1]!.points;
        const rank = tiedWithPrevious ? ranks[ranks.length - 1]!.rank : index + 1;
        ranks.push({ fpid: entry.fpid, rank });
      });
    }
    return ranks;
  },
});
