import { v } from "convex/values";
import { query } from "../../_generated/server";
import { requireSeasonOwner } from "../../lib/access";
import { isUsagePosition, usageScore, type UsageScore } from "../../lib/usageScore";
import { scoringConfigFromSeason } from "../../scoring";
import { loadPlayerSeason } from "./gameLog";

export interface UsageWeek extends UsageScore {
  week: number;
  // Same weeks as the game log: "played", "dnp" (his team played, he
  // didn't), or "bye" - the score parts are 0 for the last two.
  kind: "played" | "dnp" | "bye";
}

// One player's weekly usage score for one NFL season, in this league's
// scoring (see lib/usageScore.ts) - the player popover's usage chart.
// `average` is across the games he played (null before his first). Null
// for a player who isn't in the players table or plays a position the score
// doesn't cover (K, DST).
export const getUsageWeeks = query({
  args: { seasonId: v.id("seasons"), fpid: v.number(), year: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ position: "QB" | "RB" | "WR" | "TE"; weeks: UsageWeek[]; average: number | null } | null> => {
    const { season } = await requireSeasonOwner(ctx, args.seasonId);
    const config = scoringConfigFromSeason(season);
    const loaded = await loadPlayerSeason(ctx, { fpid: args.fpid, year: args.year, config });
    if (!loaded) return null;
    const position = loaded.position;
    if (!isUsagePosition(position)) return null;

    const weeks: UsageWeek[] = loaded.weeks.map((week) =>
      week.row
        ? { week: week.week, kind: week.kind, ...usageScore(week.row.stats, position, config) }
        : { week: week.week, kind: week.kind, pass: 0, rush: 0, rec: 0, total: 0, expectedPoints: 0 },
    );
    const played = weeks.filter((week) => week.kind === "played");
    const average =
      played.length > 0 ? played.reduce((sum, week) => sum + week.total, 0) / played.length : null;
    return { position, weeks, average };
  },
});
