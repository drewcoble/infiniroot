import type { Position } from "../types";

export type ConsistencyLabel = "Reliable" | "Boom/Bust" | "Low Output";

// A player needs at least this many games in a season before their PPG or
// week-to-week volatility means anything - otherwise a 1-3 game sample
// could produce a wildly misleading label.
const MIN_GAMES = 4;

// Below this PPG, a player is presumed to have been a committee/deep-bench
// afterthought last season rather than someone who was ever actually
// startable - checked against 2025 season stats + 2026 ADP: without this
// floor, ~80% of "Low Output" tags landed on players who have no real ADP
// this year (and so never even appear in the UI to be filtered against),
// because low scorers are disproportionately practice-squad/committee
// players rather than legitimately bad starters. Values are set just below
// the lowest PPG among last season's players who *do* carry a real ADP this
// year, position by position (DST is exempt - already naturally capped at
// 32, same reasoning as filterRelevantPlayers in relevantPlayers.ts). This
// materially reduces but doesn't eliminate the mismatch, since last
// season's PPG only loosely predicts this year's draft relevance (injury,
// depth-chart, and roster moves shift ADP in ways scoring history can't
// see) - a full fix would join against current ADP instead, at the cost of
// requiring that data to be loaded wherever consistency is computed.
const MIN_PPG_BY_POSITION: Record<Position, number> = {
  QB: 10,
  RB: 4,
  WR: 4.5,
  TE: 5,
  K: 6,
  DST: 0,
};

export interface ConsistencyThresholds {
  lowPpg: number;
  highPpg: number;
  reliableCv: number;
  boomBustCv: number;
  lowOutputCv: number;
}

function percentile(sortedAsc: number[], p: number): number {
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.floor(p * sortedAsc.length))]!;
}

// PPG terciles for one position's season cohort (bottom third "low", top
// third "high"), same as before. Week-to-week coefficient of variation
// (downsideDeviation / PPG) is then tercile-split *separately within* the
// high-PPG and low-PPG cohorts, rather than once globally. downsideDeviation
// (see convex/playerPoints.ts) only counts games that fell short of the
// player's own season PPG, unlike a plain symmetric stdDeviation - a player
// with a high floor who occasionally has a monster game would get flagged
// as high-variance by a symmetric measure even though they never actually
// bust, which isn't what "Boom/Bust" is supposed to mean here. CV still
// correlates with PPG - low scorers skew boom/bust (a deep-bench flier's
// variance is large relative to their small mean) rather than "consistently
// bad" - so a single global CV split stuffed the low-CV tercile with
// high-PPG players almost by default: checked against real 2025 PPR stats,
// that produced ~94 "Reliable" players against only ~39 "Low Output" for
// the same cohort sizes. Splitting CV within each PPG cohort instead means
// exactly the bottom third of the high-PPG group can be "Reliable" and
// exactly the bottom third of the low-PPG group can be "Low Output",
// which balances the two labels out (~59 each) without changing what
// "average on either axis gets no label" means.
export function computeConsistencyThresholds(
  position: Position,
  rows: Array<{ totalPoints: number; gamesPlayed: number; downsideDeviation: number }>,
): ConsistencyThresholds | null {
  const minPpg = MIN_PPG_BY_POSITION[position];
  const eligible = rows.filter(
    (row) =>
      row.gamesPlayed >= MIN_GAMES && row.totalPoints / row.gamesPlayed >= minPpg,
  );
  if (eligible.length === 0) return null;
  const withStats = eligible.map((row) => {
    const ppg = row.totalPoints / row.gamesPlayed;
    return { ppg, cv: ppg > 0 ? row.downsideDeviation / ppg : Infinity };
  });
  const ppgs = withStats.map((r) => r.ppg).sort((a, b) => a - b);
  const lowPpg = percentile(ppgs, 1 / 3);
  const highPpg = percentile(ppgs, 2 / 3);

  const highGroupCvs = withStats
    .filter((r) => r.ppg >= highPpg)
    .map((r) => r.cv)
    .sort((a, b) => a - b);
  const lowGroupCvs = withStats
    .filter((r) => r.ppg <= lowPpg)
    .map((r) => r.cv)
    .sort((a, b) => a - b);

  return {
    lowPpg,
    highPpg,
    reliableCv: percentile(highGroupCvs, 1 / 3),
    boomBustCv: percentile(highGroupCvs, 2 / 3),
    lowOutputCv: percentile(lowGroupCvs, 1 / 3),
  };
}

// Reliable = high PPG, low variance within the high-PPG cohort
// ("consistently not bad"). Boom/Bust = high PPG, high variance within
// that same cohort (a real toss-up between a dud and a monster week). Low
// Output = low PPG, low variance within the low-PPG cohort (consistently
// bad). Everyone else - average PPG, or low-PPG/high-variance "deep-bench
// flier" - gets no label.
export function getConsistencyLabel(
  position: Position,
  player: { totalPoints: number; gamesPlayed: number; downsideDeviation: number },
  thresholds: ConsistencyThresholds | null,
): ConsistencyLabel | null {
  if (player.gamesPlayed < MIN_GAMES || !thresholds) return null;
  const ppg = player.totalPoints / player.gamesPlayed;
  if (ppg < MIN_PPG_BY_POSITION[position]) return null;
  const cv = ppg > 0 ? player.downsideDeviation / ppg : Infinity;
  if (ppg >= thresholds.highPpg) {
    if (cv <= thresholds.reliableCv) return "Reliable";
    if (cv >= thresholds.boomBustCv) return "Boom/Bust";
    return null;
  }
  if (ppg <= thresholds.lowPpg && cv <= thresholds.lowOutputCv) return "Low Output";
  return null;
}

// Stoplight scheme: Reliable (green/go), Boom/Bust (orange/caution), Low
// Output (red/stop).
export function consistencyColor(label: ConsistencyLabel): string {
  if (label === "Reliable") return "green";
  if (label === "Boom/Bust") return "orange";
  return "red";
}
