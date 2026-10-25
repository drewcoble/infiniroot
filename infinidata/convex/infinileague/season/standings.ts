import { v } from "convex/values";
import { query } from "../../_generated/server";
import { Doc, Id } from "../../_generated/dataModel";
import { requireSeasonOwner } from "../../lib/access";

export interface StandingsRow {
  teamId: Id<"seasonTeams">;
  name: string;
  // The provider's team logo/avatar (schema.ts's seasonTeams.logoUrl) -
  // absent shows the team's initials.
  logoUrl?: string;
  isSelf: boolean;
  rank: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  // Exactly one of these is set, chosen by the season's waiverType (see
  // schema.ts's seasons.waiverType comment) - explicit named fields rather
  // than one ambiguous "value" so a caller never has to guess which one a
  // number means.
  faabRemaining?: number;
  waiverPosition?: number;
}

type RecordFields = Pick<Doc<"seasonTeams">, "wins" | "losses" | "ties" | "pointsFor">;

function winPct(team: RecordFields): number {
  const wins = team.wins ?? 0;
  const losses = team.losses ?? 0;
  const ties = team.ties ?? 0;
  const games = wins + losses + ties;
  return games === 0 ? 0 : (wins + 0.5 * ties) / games;
}

// Standings order - win percentage, points scored as tiebreaker. Shared
// with projectedStandings.ts so a projected final table sorts the same way.
export function compareStandings(a: RecordFields, b: RecordFields): number {
  const pctDiff = winPct(b) - winPct(a);
  if (pctDiff !== 0) return pctDiff;
  return (b.pointsFor ?? 0) - (a.pointsFor ?? 0);
}

// Current season-to-date standings for infinileague's league page - ranked
// by win percentage, points scored as tiebreaker (both per the product
// requirement, not an arbitrary choice). Reads whatever convex/sleeper/
// league.ts's syncLeagueRoster last wrote to seasonTeams/seasons - this
// query does no fetching of its own, so it's only as fresh as the last
// sync (see infinileague's league page for the staleness/auto-sync UI).
export const getStandings = query({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args): Promise<StandingsRow[]> => {
    const { season } = await requireSeasonOwner(ctx, args.seasonId);
    const teams = await ctx.db
      .query("seasonTeams")
      .withIndex("by_season", (q) => q.eq("seasonId", args.seasonId))
      .collect();

    const sorted = [...teams].sort(compareStandings);

    return sorted.map((team, index) => ({
      teamId: team._id,
      name: team.name,
      ...(team.logoUrl ? { logoUrl: team.logoUrl } : {}),
      isSelf: team.isSelf,
      rank: index + 1,
      wins: team.wins ?? 0,
      losses: team.losses ?? 0,
      ties: team.ties ?? 0,
      pointsFor: team.pointsFor ?? 0,
      pointsAgainst: team.pointsAgainst ?? 0,
      ...(season.waiverType === "faab"
        ? {
            faabRemaining:
              (team.faabBudgetOverride ?? season.faabBudget ?? 0) -
              (team.faabSpent ?? 0),
          }
        : team.waiverPosition !== undefined
          ? { waiverPosition: team.waiverPosition }
          : {}),
    }));
  },
});
