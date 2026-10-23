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
      projected += liveProjection(starter, remainingFraction(game, now));
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

// A team's Elimination Watch standing as a badge. Same red/gold/green
// three-band convention lib/gradeColor.ts uses (see that file's comment on
// why those, not raw Mantine "yellow"), keyed off eliminationWatch.ts's own
// cut/bubble/safe status instead of a continuous score - plus "eliminated"
// for a team already out (no longer in the watch at all), on the team page.
export type EliminationStatus = EliminationWatchRow["status"] | "eliminated";

export const ELIMINATION_STATUS_BADGE: Record<EliminationStatus, { label: string; color: string }> =
  {
    cut: { label: "Projected Cut", color: "red" },
    bubble: { label: "Bubble", color: "gold" },
    safe: { label: "Safe", color: "green" },
    eliminated: { label: "Eliminated", color: "gray" },
  };
