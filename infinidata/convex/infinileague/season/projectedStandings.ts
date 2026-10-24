import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import { Doc, Id } from "../../_generated/dataModel";
import { computeTeamWeekTotals, gatherPowerRankingsInputs } from "./powerRankings";
import { loadLeagueSchedule } from "./schedule";
import { compareStandings } from "./standings";

export interface ProjectedStandingsRow {
  teamId: Id<"seasonTeams">;
  name: string;
  logoUrl?: string;
  isSelf: boolean;
  // Projected final rank, and today's standings rank.
  rank: number;
  currentRank: number;
  // Projected rank last snapshotted week minus this week's (positive =
  // projected finish moved up) - absent with no earlier snapshot, same as
  // PowerRankingRow's rankChange.
  rankChange?: number;
  // Projected final record and points for - current plus every remaining
  // regular-season week. Wins/losses are expected values (fractional): each
  // remaining game adds its win probability to wins and the rest to losses.
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  // Today's record, for the "now" comparison.
  currentWins: number;
  currentLosses: number;
  currentTies: number;
}

interface TeamRecord {
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
}

// Latest snapshot strictly before `beforeWeek` - same as powerRankings.ts's
// getLatestSnapshotBeforeWeek.
export const getLatestSnapshotBeforeWeek = internalQuery({
  args: { seasonId: v.id("seasons"), beforeWeek: v.string() },
  handler: async (ctx, args): Promise<Doc<"projectedStandingsSnapshots"> | null> => {
    const rows = await ctx.db
      .query("projectedStandingsSnapshots")
      .withIndex("by_season_week", (q) => q.eq("seasonId", args.seasonId))
      .collect();
    const before = rows.filter((row) => Number(row.week) < Number(args.beforeWeek));
    if (before.length === 0) return null;
    return before.reduce((latest, row) =>
      Number(row.week) > Number(latest.week) ? row : latest,
    );
  },
});

// Upserted on every run - same-week reruns refresh that week's row, same as
// powerRankings.ts's saveSnapshot.
export const saveSnapshot = internalMutation({
  args: {
    seasonId: v.id("seasons"),
    week: v.string(),
    teamIds: v.array(v.id("seasonTeams")),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("projectedStandingsSnapshots")
      .withIndex("by_season_week", (q) =>
        q.eq("seasonId", args.seasonId).eq("week", args.week),
      )
      .first();
    const computedAt = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { teamIds: args.teamIds, computedAt });
    } else {
      await ctx.db.insert("projectedStandingsSnapshots", {
        seasonId: args.seasonId,
        week: args.week,
        teamIds: args.teamIds,
        computedAt,
      });
    }
  },
});

// A team's weekly score spread (standard deviation) as a share of its
// projected total. Measured 2026-10-24 across four Sleeper leagues' weeks
// 1-6: actual scores swung ~18% around each team's own average; a little
// wider here since a projection also misses the average itself.
const SCORE_SD_SHARE = 0.2;

// Standard normal CDF (Abramowitz & Stegun 7.1.26 erf, error < 1.5e-7).
function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly =
    t *
    (0.254829592 +
      t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

// Chance a score projected at `margin` points ahead (with this combined
// variance) finishes ahead - 0.5 when there's no spread at all to go on.
function winProbability(margin: number, variance: number): number {
  if (variance <= 0) return margin > 0 ? 1 : margin < 0 ? 0 : 0.5;
  return normalCdf(margin / Math.sqrt(variance));
}

function scoreVariance(projected: number): number {
  return (SCORE_SD_SHARE * projected) ** 2;
}

// Yahoo-style projected final standings, with win probabilities instead of
// all-or-nothing picks: each remaining regular-season matchup's projected
// margin (the same per-week optimal-lineup totals power rankings sums) and
// both teams' score spread give a win probability, added onto each team's
// current record as expected wins/losses, then sorted the same way as
// getStandings. A league that plays the median too gets a weekly game
// against the median projected score.
export const getProjectedStandings = action({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx: ActionCtx, args): Promise<ProjectedStandingsRow[]> => {
    const { season, league } = await ctx.runQuery(internal.rosterSync.requireOwnedSeasonForSync, {
      seasonId: args.seasonId,
    });
    if (season.leagueType === "guillotine") {
      throw new Error("Guillotine leagues don't have head-to-head standings.");
    }
    const inputs = await gatherPowerRankingsInputs(ctx, args.seasonId);
    const { teams, currentWeek, eligibleFpidsByTeam } = inputs;

    const schedule = await loadLeagueSchedule(ctx, season, league, teams, currentWeek);

    // Records already counting this week's games (a Tuesday after Monday
    // night, before the NFL week rolls over) mustn't be counted twice - so
    // projection starts after the most games any team has played. Assumes
    // the league started in week 1.
    const gamesPerWeek = schedule.medianGame ? 2 : 1;
    const mostGamesPlayed = Math.max(
      0,
      ...teams.map((team) => (team.wins ?? 0) + (team.losses ?? 0) + (team.ties ?? 0)),
    );
    const startWeek = Math.max(currentWeek, Math.ceil(mostGamesPlayed / gamesPerWeek) + 1);
    const endWeek = schedule.regularSeasonEndWeek;

    const weekTotalsByTeam = new Map<Id<"seasonTeams">, number[]>();
    for (const team of teams) {
      const fpids = eligibleFpidsByTeam.get(team._id);
      if (fpids) weekTotalsByTeam.set(team._id, computeTeamWeekTotals(fpids, inputs));
    }
    const weekTotal = (teamId: Id<"seasonTeams">, week: number): number =>
      weekTotalsByTeam.get(teamId)?.[week - currentWeek] ?? 0;

    const recordByTeam = new Map<Id<"seasonTeams">, TeamRecord>(
      teams.map((team) => [
        team._id,
        {
          wins: team.wins ?? 0,
          losses: team.losses ?? 0,
          ties: team.ties ?? 0,
          pointsFor: team.pointsFor ?? 0,
        },
      ]),
    );
    const award = (teamId: Id<"seasonTeams">, winProb: number) => {
      const record = recordByTeam.get(teamId);
      if (!record) return;
      record.wins += winProb;
      record.losses += 1 - winProb;
    };

    for (let week = startWeek; week <= endWeek; week++) {
      for (const team of teams) {
        const record = recordByTeam.get(team._id);
        if (record) record.pointsFor += weekTotal(team._id, week);
      }
      if (schedule.medianGame) {
        const totals = teams.map((team) => weekTotal(team._id, week)).sort((a, b) => a - b);
        const mid = Math.floor(totals.length / 2);
        const median =
          totals.length % 2 === 0
            ? ((totals[mid - 1] ?? 0) + (totals[mid] ?? 0)) / 2
            : (totals[mid] ?? 0);
        for (const team of teams) {
          const total = weekTotal(team._id, week);
          award(team._id, winProbability(total - median, scoreVariance(total)));
        }
      }
    }

    // A multi-week matchup already under way only counts its remaining
    // weeks' projections - points it has already scored aren't added.
    for (const matchup of schedule.matchups) {
      const weeks = matchup.weeks.filter((week) => week >= startWeek && week <= endWeek);
      if (weeks.length === 0) continue;
      const [a, b] = matchup.teamIds;
      let margin = 0;
      let variance = 0;
      for (const week of weeks) {
        margin += weekTotal(a, week) - weekTotal(b, week);
        variance += scoreVariance(weekTotal(a, week)) + scoreVariance(weekTotal(b, week));
      }
      const winProb = winProbability(margin, variance);
      award(a, winProb);
      award(b, 1 - winProb);
    }

    const currentRankByTeam = new Map(
      [...teams].sort(compareStandings).map((team, index) => [team._id, index + 1]),
    );
    const projected = teams
      .map((team) => ({ team, record: recordByTeam.get(team._id)! }))
      .sort((a, b) => compareStandings(a.record, b.record));

    const currentWeekStr = String(currentWeek);
    const previousSnapshot = await ctx.runQuery(
      internal.infinileague.season.projectedStandings.getLatestSnapshotBeforeWeek,
      { seasonId: args.seasonId, beforeWeek: currentWeekStr },
    );
    const previousRankByTeam = new Map<Id<"seasonTeams">, number>();
    previousSnapshot?.teamIds.forEach((teamId, i) => previousRankByTeam.set(teamId, i + 1));
    await ctx.runMutation(internal.infinileague.season.projectedStandings.saveSnapshot, {
      seasonId: args.seasonId,
      week: currentWeekStr,
      teamIds: projected.map(({ team }) => team._id),
    });

    return projected.map(({ team, record }, index) => {
      const previousRank = previousRankByTeam.get(team._id);
      return {
        teamId: team._id,
        name: team.name,
        ...(team.logoUrl ? { logoUrl: team.logoUrl } : {}),
        isSelf: team.isSelf,
        rank: index + 1,
        currentRank: currentRankByTeam.get(team._id) ?? index + 1,
        ...(previousRank !== undefined ? { rankChange: previousRank - (index + 1) } : {}),
        wins: record.wins,
        losses: record.losses,
        ties: record.ties,
        pointsFor: record.pointsFor,
        currentWins: team.wins ?? 0,
        currentLosses: team.losses ?? 0,
        currentTies: team.ties ?? 0,
      };
    });
  },
});
