import { QueryCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import type { POSITIONS } from "../positions";
import { bonusPoints, pointsForScoring, scoringConfigFromSeason } from "../scoring";

// Every player's actual fantasy points for one week, in this season's
// scoring (base format + TE premium / 6pt passing TD bonus). Shared by
// convex/rosVor.ts's getWeekPoints (Players tab) and
// convex/infinileague/season/matchup.ts's getWeekPositionRanks (Matchup
// tab) - callers do their own access check first. A player with no entry
// hasn't played yet.
export async function loadWeekPoints(
  ctx: QueryCtx,
  seasonId: Id<"seasons">,
  week: string,
): Promise<Array<{ fpid: number; position: (typeof POSITIONS)[number]; points: number }>> {
  const [settings, nflState] = await Promise.all([
    ctx.db.get(seasonId),
    ctx.db.query("nflState").first(),
  ]);
  if (!settings || !nflState) return [];
  const scoringConfig = scoringConfigFromSeason(settings);

  // Live in-game points (convex/sleeper/livePoints.ts) win when the
  // 2-minute poll has written a document for this week - fresher than
  // playerPoints (daily sync) and one read instead of ~1,800. Falls back
  // to playerPoints otherwise (no game live yet this week, or a past week
  // whose live copy the daily sync has already pruned). Same
  // nflState.season rosVor.ts's computeRosVorInputs playerPoints reads use.
  const liveWeek = await ctx.db
    .query("liveWeekPoints")
    .withIndex("by_season_week", (q) => q.eq("season", nflState.season).eq("week", week))
    .first();
  if (liveWeek) {
    return liveWeek.players.map((entry) => ({
      fpid: entry.fpid,
      position: entry.position,
      points:
        pointsForScoring(
          { pointsStd: entry.ptsStd, pointsHalf: entry.ptsHalf, pointsPpr: entry.ptsPpr },
          scoringConfig.scoring,
        ) + bonusPoints({ position: entry.position, stats: { rec: entry.rec, pass_td: entry.passTd } }, scoringConfig),
    }));
  }

  const rows = await ctx.db
    .query("playerPoints")
    .withIndex("by_season_week_fpid", (q) => q.eq("season", nflState.season).eq("week", week))
    .collect();
  return rows
    .filter((row) => row.scoring === scoringConfig.scoring)
    .map((row) => ({
      fpid: row.fpid,
      position: row.position,
      points: row.points + bonusPoints({ position: row.position, stats: row.stats ?? {} }, scoringConfig),
    }));
}
