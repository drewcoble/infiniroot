import { v } from "convex/values";
import { query } from "../../_generated/server";
import { requireSeasonOwner } from "../../lib/access";
import { MATCHUP_FIRST_WEEK } from "../../lib/matchupCalibration";
import { gradeDefenseMatchups, type DefenseMatchupGrade } from "../../lib/matchupDifficulty";
import { scoringConfigFromSeason } from "../../scoring";

// Every defense's matchup grade at QB/RB/WR/TE for one week, in this
// league's scoring (see lib/matchupDifficulty.ts) - the Matchup and team
// cards look a player up by his opponent and position. Graded on games
// before `week` (the latest defenseMatchupSets doc through week - 1), so a
// past week shows what was known going into it. Null before
// MATCHUP_FIRST_WEEK, or before any set has been built.
export const getMatchupDifficulty = query({
  args: { seasonId: v.id("seasons"), week: v.string() },
  handler: async (ctx, args): Promise<DefenseMatchupGrade[] | null> => {
    const { season } = await requireSeasonOwner(ctx, args.seasonId);
    const week = Number(args.week);
    if (!(week >= MATCHUP_FIRST_WEEK)) return null;
    const set = await ctx.db
      .query("defenseMatchupSets")
      .withIndex("by_season_week", (q) => q.eq("season", season.year).lte("throughWeek", week - 1))
      .order("desc")
      .first();
    if (!set) return null;
    return gradeDefenseMatchups(set.rows, scoringConfigFromSeason(season));
  },
});
