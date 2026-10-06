import type { GlassMatchupCardData } from "./GlassMatchupCard";

// Largest value any card's meter needs to show, with a floor so a quiet
// early-week page (everyone pregame, small projections) doesn't stretch a
// 6-point kicker into a nearly full bar.
const METER_SCALE_FLOOR = 25;

export function meterScaleMax(cards: GlassMatchupCardData[]): number {
  return cards.reduce(
    (max, card) =>
      Math.max(max, card.actualPoints ?? 0, card.projectedPoints ?? 0, card.liveProjectedPoints ?? 0),
    METER_SCALE_FLOOR,
  );
}
