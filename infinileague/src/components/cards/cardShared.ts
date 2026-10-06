import type { CSSProperties } from "react";
import type { Position } from "@shared/positionColors";

// Shared by the base Matchup card (GlassMatchupCard.tsx) and its long-press
// detail card (ExpandedMatchupCard.tsx).

// Where this player's game is this week - drives the card's emphasis and
// which projection it shows (pregame vs. live), same states the current
// Matchup tab derives from lib/liveGames.ts.
export type GameState = "pre" | "live" | "final" | "bye";

export interface GlassMatchupCardData {
  name: string;
  position: Position;
  positionRank: number;
  team: string;
  // "vs. KC" / "@ BUF" / "BYE", and "Q3 8:12" / "Sun 4:25 PM" / "Final"
  // (absent on a bye) - the two halves of formatGameLine's output, split so
  // the detail card can lay them out separately.
  matchup: string;
  status?: string;
  // Epoch ms - sets the pregame clock icon's hands (see GameStatusGlyph).
  kickoffAt?: number;
  gameState: GameState;
  projectedPoints?: number;
  // Live projection (points so far + unplayed share of the projection) -
  // only read while gameState is "live".
  liveProjectedPoints?: number;
  actualPoints?: number;
  injury?: { status: string; statusShort: string };
  // Detail-card only.
  isRookie?: boolean;
  byeWeek?: number;
  // Season-to-date and rest-of-season points per game, and this week's
  // position rank - the Players tab's rosVOR snapshot fields (actualPpg,
  // rosPpg, weekPositionRank).
  seasonPpg?: number;
  rosPpg?: number;
  weekPositionRank?: number;
}

export function gameLine(data: GlassMatchupCardData): string {
  return data.status ? `${data.matchup} · ${data.status}` : data.matchup;
}

// Each pill is a small glass pane tinted by its theme color (--pill-tint,
// see .pill). The pane carries the color; text stays near-white with just a
// hint of it, since a full light shade over its own tint read too faintly.
export function pillStyle(color: string) {
  return {
    color: `color-mix(in srgb, var(--mantine-color-${color}-1) 30%, #fff)`,
    "--pill-tint": `var(--mantine-color-${color}-4)`,
  } as CSSProperties;
}

export function formatPoints(points: number | undefined): string {
  return points === undefined ? "—" : points.toFixed(2);
}

export function formatProj(points: number | undefined): string {
  return points === undefined ? "—" : points.toFixed(1);
}

// How far the live projection can drift from the pregame one and still
// count as "on projection" - relative rather than a flat point count, since
// 2 points is noise for a 24-point QB but a big swing for an 8-point kicker.
// The floor keeps tiny projections from flipping on a single point.
const PACE_BUFFER_SHARE = 0.1;
const PACE_BUFFER_MIN = 1;

export type Pace = "ahead" | "even" | "behind";

export function paceVsProjection(
  projected: number | undefined,
  liveProjected: number | undefined,
): Pace | undefined {
  if (projected === undefined || liveProjected === undefined) return undefined;
  const buffer = Math.max(projected * PACE_BUFFER_SHARE, PACE_BUFFER_MIN);
  if (liveProjected > projected + buffer) return "ahead";
  if (liveProjected < projected - buffer) return "behind";
  return "even";
}

// Where the meter's pace color comes from: the live projection mid-game,
// the final score once it's over, nothing before kickoff or on a bye.
export function paceFor(data: GlassMatchupCardData): Pace | undefined {
  if (data.gameState === "live") {
    return paceVsProjection(data.projectedPoints, data.liveProjectedPoints);
  }
  if (data.gameState === "final") return paceVsProjection(data.projectedPoints, data.actualPoints);
  return undefined;
}
