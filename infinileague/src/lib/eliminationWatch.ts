import { liveProjection, remainingFraction, type WeekGame } from "./liveGames";
import type { EliminationWatchRow } from "../types/season";

// An Elimination Watch row as the list shows it - weekPoints is the live
// projection, plus the points scored so far once the week is underway.
export interface LiveEliminationRow extends EliminationWatchRow {
  actualPoints?: number;
}

// Same danger zone as convex/infinileague/season/eliminationWatch.ts - the
// lowest team is the projected cut, the next ~25% (minimum 2) the bubble.
function dangerZoneSize(activeTeamCount: number): number {
  return Math.max(2, Math.ceil(activeTeamCount * 0.25));
}

// Re-ranks every team by its set lineup's live projection - points so far
// plus the unplayed share of each starter's projection, same as the Matchup
// tab - so teams move up and down as their players score. Before kickoff
// that's just the pregame projection the server already ranked by. Until
// the week's slate loads, the server's ranking stands as-is.
export function rankLive(
  rows: EliminationWatchRow[],
  games: WeekGame[] | undefined,
  now: number,
): LiveEliminationRow[] {
  if (!games) return rows;
  const gamesByTeam = new Map(games.map((game) => [game.team, game]));
  const weekStarted = games.some((game) => game.kickoffAt <= now);

  const scored = rows.map((row) => {
    let projected = 0;
    let actual = 0;
    for (const starter of row.starters) {
      const game = starter.team ? gamesByTeam.get(starter.team) : undefined;
      projected += liveProjection(
        starter.projectedPoints,
        starter.actualPoints,
        remainingFraction(game, now),
        starter.position,
      );
      actual += starter.actualPoints ?? 0;
    }
    return { ...row, weekPoints: projected, ...(weekStarted ? { actualPoints: actual } : {}) };
  });
  scored.sort((a, b) => b.weekPoints - a.weekPoints);

  const zoneSize = dangerZoneSize(scored.length);
  return scored.map((row, index) => {
    const rankFromBottom = scored.length - index;
    return {
      ...row,
      rank: index + 1,
      status: rankFromBottom === 1 ? "cut" : rankFromBottom <= zoneSize ? "bubble" : "safe",
    };
  });
}
