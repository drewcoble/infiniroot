import type { GlassMatchupCardData } from "../components/cards/cardShared";
import type { RosVorRow, TeamRosterRow } from "../types/season";
import {
  formatGameStatus,
  formatMatchup,
  isGameFinal,
  isGameInProgress,
  liveProjection,
  remainingFraction,
  type WeekGame,
} from "./liveGames";

// One roster row as a glass card's data - this week's game state, game
// line, and points, plus the season/ROS context from the rosVOR board and
// this week's actual position rank (convex/infinileague/season/matchup.ts's
// getWeekPositionRanks). `gamesByTeam` undefined (slate still loading, or
// never synced) falls back to a plain pregame card with just the NFL team.
export function toMatchupCardData(
  row: TeamRosterRow,
  gamesByTeam: Map<string, WeekGame> | undefined,
  now: number,
  vor: RosVorRow | undefined,
  weekRank: number | undefined,
): GlassMatchupCardData {
  const base = {
    name: row.name ?? "",
    position: row.position ?? "QB",
    positionRank: vor?.positionRank ?? 0,
    team: row.team ?? "",
    ...(row.projectedPoints !== undefined ? { projectedPoints: row.projectedPoints } : {}),
    ...(row.actualPoints !== undefined ? { actualPoints: row.actualPoints } : {}),
    ...(row.injury ? { injury: row.injury } : {}),
    ...(row.isRookie ? { isRookie: true } : {}),
    ...(row.byeWeek !== undefined ? { byeWeek: row.byeWeek } : {}),
    ...(vor ? { seasonPpg: vor.actualPpg, rosPpg: vor.rosPpg } : {}),
    ...(vor && vor.weekPositionRank > 0 ? { weekPositionRank: vor.weekPositionRank } : {}),
    ...(weekRank !== undefined ? { weekActualPositionRank: weekRank } : {}),
  };

  if (!gamesByTeam || gamesByTeam.size === 0 || !row.team) {
    return { ...base, matchup: row.team ?? "", gameState: "pre" };
  }
  const game = gamesByTeam.get(row.team);
  if (!game) return { ...base, matchup: "BYE", gameState: "bye" };

  const matchup = formatMatchup(game);
  const status = formatGameStatus(game, now);
  // IR players don't play even when their team does - shown like a bye
  // (dimmed, no points or meter), same "no live emphasis for IR" rule the
  // old cards had, with the real game line kept for context.
  if (row.slot === "IR") return { ...base, matchup, status, gameState: "bye" };
  if (isGameInProgress(game, now)) {
    return {
      ...base,
      matchup,
      status,
      gameState: "live",
      liveProjectedPoints: liveProjection(
        row.projectedPoints,
        row.actualPoints,
        remainingFraction(game, now),
      ),
    };
  }
  return { ...base, matchup, status, gameState: isGameFinal(game, now) ? "final" : "pre" };
}
