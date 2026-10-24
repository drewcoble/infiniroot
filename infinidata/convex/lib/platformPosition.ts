import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { POSITIONS } from "../positions";

type Position = (typeof POSITIONS)[number];

// See schema.ts's platformPositions: a league follows its own platform's
// position for the handful of players that platform disagrees with Sleeper
// on. Sleeper-linked and unlinked seasons have no overrides.
export type Platform = Doc<"platformPositions">["platform"];

export function seasonPlatform(
  season: Pick<Doc<"seasons">, "espnLeagueId" | "yahooLeagueKey">,
): Platform | null {
  if (season.espnLeagueId) return "espn";
  if (season.yahooLeagueKey) return "yahoo";
  return null;
}

// fpid -> the season's platform position, only for players whose differs.
export async function loadPlatformPositions(
  ctx: QueryCtx,
  season: Pick<Doc<"seasons">, "espnLeagueId" | "yahooLeagueKey">,
): Promise<Map<number, Position>> {
  const platform = seasonPlatform(season);
  if (!platform) return new Map();
  const rows = await ctx.db
    .query("platformPositions")
    .withIndex("by_platform_fpid", (q) => q.eq("platform", platform))
    .collect();
  return new Map(rows.map((row) => [row.fpid, row.position]));
}

// Yahoo's display_position (possibly comma-joined, e.g. "WR,RB", primary
// first) or ESPN's mapped position -> one of ours, for recording. DST is
// never recorded: team defenses can't disagree on position.
export function recordablePosition(position: string | undefined): Position | null {
  const primary = position?.split(",")[0]?.trim().toUpperCase();
  return primary === "QB" || primary === "RB" || primary === "WR" || primary === "TE" || primary === "K"
    ? primary
    : null;
}
