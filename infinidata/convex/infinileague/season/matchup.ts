import { v } from "convex/values";
import { action, ActionCtx, query } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import { Id } from "../../_generated/dataModel";
import { fetchSleeperJson } from "../../sleeper/league";
import { fetchYahooOpponentTeamKey } from "../../infinidraft/yahoo/league";
import { withYahooToken } from "../../infinidraft/yahoo/oauth";
import { cachedYahoo } from "../../infinidraft/yahoo/cache";
import { fetchEspnOpponentTeamId } from "../../espn/league";
import {
  loadTeamRosterForWeek,
  type SleeperMatchupEntry,
  type SlotLabel,
  type TeamRosterRow,
} from "./teamRoster";
import { loadWeekPairs } from "./schedule";
import { requireSeasonOwner } from "../../lib/access";
import { loadWeekPoints } from "../../lib/weekPoints";
import { loadPlatformPositions } from "../../lib/platformPosition";

// How long a Yahoo team's weekly opponent is reused - see
// infinidraft/yahoo/cache.ts.
const YAHOO_OPPONENT_CACHE_MS = 6 * 60 * 60 * 1000;

// Who a team is playing this week - Sleeper-linked teams resolve it from
// matchup_id (Sleeper groups exactly two roster_ids under the same
// matchup_id per week - documented behavior); Yahoo-linked teams resolve it
// from the league's scoreboard resource (see fetchYahooOpponentTeamKey,
// NOT confirmed against a live response - see YAHOO.md); ESPN-linked teams
// from the league's schedule (see fetchEspnOpponentTeamId). Unlinked teams, or
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
      // A week's pairings are set in advance - cached rather than re-read
      // from Yahoo's scoreboard on every Matchup page load.
      const leagueKey = season.yahooLeagueKey;
      const teamKey = team.yahooTeamKey;
      const opponentTeamKey = await cachedYahoo(
        ctx,
        `opponent:${teamKey}:${args.week}`,
        YAHOO_OPPONENT_CACHE_MS,
        () =>
          withYahooToken(ctx, league.ownerId, (accessToken) =>
            fetchYahooOpponentTeamKey(accessToken, leagueKey, args.week, teamKey),
          ),
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

    if (team.espnTeamId && season.espnLeagueId) {
      const opponentEspnTeamId = await fetchEspnOpponentTeamId(
        season.espnLeagueId,
        season.year,
        args.week,
        team.espnTeamId,
      );
      if (opponentEspnTeamId === null) {
        return { opponentTeamId: null };
      }
      const teams = await ctx.runQuery(internal.seasonTeams.listSeasonTeamsInternal, {
        seasonId: team.seasonId,
      });
      const opponentTeam = teams.find((t) => t.espnTeamId === opponentEspnTeamId);
      return { opponentTeamId: opponentTeam?._id ?? null };
    }

    return { opponentTeamId: null };
  },
});

// Starting slots - same list as eliminationWatch.ts's.
const STARTER_SLOTS = new Set<SlotLabel>(["QB", "SUPERFLEX", "RB", "WR", "FLEX", "TE", "DST", "K"]);

export interface LeagueWeekMatchups {
  // A playoff week has no trusted pairings (see schedule.ts's
  // loadWeekPairs), so matchups comes back empty.
  isPlayoffWeek: boolean;
  matchups: { teamAId: Id<"seasonTeams">; teamBId: Id<"seasonTeams"> }[];
  // Each paired team's starters for the week - what the score cards need.
  startersByTeam: { teamId: Id<"seasonTeams">; rows: TeamRosterRow[] }[];
}

// Every matchup in a league for one week (past, current or future), for
// the Matchup tab's league view: the week's pairings from the provider plus
// each team's starting lineup, loaded per team the same way
// eliminationWatch.ts loads a whole league.
export const getLeagueWeekMatchups = action({
  args: { seasonId: v.id("seasons"), week: v.string() },
  handler: async (ctx: ActionCtx, args): Promise<LeagueWeekMatchups> => {
    const { season, league } = await ctx.runQuery(internal.rosterSync.requireOwnedSeasonForSync, {
      seasonId: args.seasonId,
    });
    if (season.leagueType === "guillotine") {
      throw new Error("Guillotine leagues don't have head-to-head matchups.");
    }
    const [teams, nflState] = await Promise.all([
      ctx.runQuery(internal.seasonTeams.listSeasonTeamsInternal, { seasonId: args.seasonId }),
      ctx.runQuery(api.nflState.getNflState, {}),
    ]);
    const currentWeek = nflState ? Math.max(Number(nflState.week), 1) : 1;
    const { isPlayoffWeek, pairs } = await loadWeekPairs(
      ctx,
      season,
      league,
      teams,
      Number(args.week),
      currentWeek,
    );

    const pairedIds = new Set(pairs.flat());
    const startersByTeam = await Promise.all(
      teams
        .filter((team) => pairedIds.has(team._id))
        .map(async (team) => ({
          teamId: team._id,
          rows: (await loadTeamRosterForWeek(ctx, { team, season, league }, args.week)).filter(
            (row) => row.slot !== undefined && STARTER_SLOTS.has(row.slot),
          ),
        })),
    );
    return {
      isPlayoffWeek,
      matchups: pairs.map(([teamAId, teamBId]) => ({ teamAId, teamBId })),
      startersByTeam,
    };
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
    const { season } = await requireSeasonOwner(ctx, args.seasonId);
    const [entries, platformPositions] = await Promise.all([
      loadWeekPoints(ctx, args.seasonId, args.week),
      loadPlatformPositions(ctx, season),
    ]);

    // Ranked at the league platform's position (see schema.ts's
    // platformPositions), matching the roster's position label.
    const byPosition = new Map<string, typeof entries>();
    for (const entry of entries) {
      const position = platformPositions.get(entry.fpid) ?? entry.position;
      const list = byPosition.get(position) ?? [];
      list.push(entry);
      byPosition.set(position, list);
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
