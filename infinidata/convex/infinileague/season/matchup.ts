import { v } from "convex/values";
import { action, ActionCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { Id } from "../../_generated/dataModel";
import { fetchSleeperJson } from "../../sleeper/league";
import type { SleeperMatchupEntry } from "./teamRoster";

// Who a Sleeper-linked team is playing this week, derived from matchup_id
// (Sleeper groups exactly two roster_ids under the same matchup_id per
// week - documented behavior). Yahoo has no matchup/schedule sync in this
// codebase yet (see YAHOO.md), so Yahoo-linked and unlinked teams just get
// opponentTeamId: null here - the Matchup tab falls back to letting the
// viewer pick an opponent manually in that case, same as a genuine bye week
// (an odd team count leaves one roster with no matchup_id some weeks).
export const getOpponentForWeek = action({
  args: { teamId: v.id("seasonTeams"), week: v.string() },
  handler: async (ctx: ActionCtx, args): Promise<{ opponentTeamId: Id<"seasonTeams"> | null }> => {
    const { team, season } = await ctx.runQuery(
      internal.infinileague.season.rosterPlayers.requireOwnedTeamForRead,
      { teamId: args.teamId },
    );

    if (!team.sleeperRosterId || !season.sleeperLeagueId) {
      return { opponentTeamId: null };
    }

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
  },
});
