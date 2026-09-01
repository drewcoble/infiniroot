// Server-side port of src/lib/consistency.ts's tercile-based consistency
// labeling (duplicated rather than imported - Convex's bundler doesn't
// allow importing across the convex/ boundary, same convention as
// expandRosterSlots/isDraftComplete in convex/lib/rosterSlots.ts). Keep the two
// in sync; formula must match exactly so a player's label never disagrees
// between the live draft board and this post-draft report.
import { POSITIONS } from "../../positions";

type Position = (typeof POSITIONS)[number];

export type ConsistencyLabel = "Reliable" | "Boom/Bust" | "Low Output";

const MIN_GAMES = 4;

// See src/lib/consistency.ts for the full rationale - keep in sync with
// that file's MIN_PPG_BY_POSITION.
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

// CV (downsideDeviation / PPG) is tercile-split *separately within* the
// high-PPG and low-PPG cohorts rather than once globally - see
// src/lib/consistency.ts for why (a global CV split skewed heavily toward
// "Reliable" over "Low Output" since low scorers trend boom/bust, not
// consistently bad), and for why downsideDeviation (only counting games
// below the player's own PPG) replaced a symmetric stdDeviation. Keep in
// sync with that file.
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
