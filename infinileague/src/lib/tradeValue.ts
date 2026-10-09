// FantasyCalc-style trade math for the Trade tab: each side's players'
// trade values (convex/infinileague/season/tradeValues.ts) added up, plus a
// consolidation adjustment so two decent players don't automatically
// out-total one star.
//
// The adjustment goes to the side sending the single most valuable player
// in the trade, and only when that side sends fewer players: the other
// side's extra pieces (its lowest-valued ones, as many as it sends beyond
// the star side's count) are worth only (1 - EXTRA_PIECE_DISCOUNT) as much
// in a trade as on paper, so the star side is credited that difference.
// Two 5,000 players for one 10,000 player: 10,000 + 2,500 vs. 10,000 - the
// star side is giving more. A 14-point throw-in barely moves anything.
const EXTRA_PIECE_DISCOUNT = 0.5;

export interface TradeTotals {
  // Sum of each side's sent players' values.
  rawA: number;
  rawB: number;
  // Consolidation credit, added to that side's sent total (at most one of
  // the two is non-zero).
  adjustmentA: number;
  adjustmentB: number;
}

function adjustmentFor(starSide: number[], otherSide: number[]): number {
  const extra = otherSide.length - starSide.length;
  if (extra <= 0) return 0;
  const lowest = [...otherSide].sort((a, b) => a - b).slice(0, extra);
  return Math.round(lowest.reduce((sum, value) => sum + value, 0) * EXTRA_PIECE_DISCOUNT);
}

export function tradeTotals(valuesA: number[], valuesB: number[]): TradeTotals {
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const topA = Math.max(0, ...valuesA);
  const topB = Math.max(0, ...valuesB);
  return {
    rawA: sum(valuesA),
    rawB: sum(valuesB),
    adjustmentA: topA > topB ? adjustmentFor(valuesA, valuesB) : 0,
    adjustmentB: topB > topA ? adjustmentFor(valuesB, valuesA) : 0,
  };
}

export function formatTradeValue(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}
