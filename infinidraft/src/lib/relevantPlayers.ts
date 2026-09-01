import type {
  Position,
  ScoringFormat,
  ScoringConfig,
  TeScoringFormat,
} from "../types";

export function pointsForScoring(
  row: { pointsStd: number; pointsHalf: number; pointsPpr: number },
  scoring: ScoringFormat,
): number {
  if (scoring === "STD") return row.pointsStd;
  if (scoring === "HALF") return row.pointsHalf;
  return row.pointsPpr;
}

export function adpForScoring(
  row: { adpStd: number; adpHalf: number; adpPpr: number },
  scoring: ScoringFormat,
): number {
  if (scoring === "STD") return row.adpStd;
  if (scoring === "HALF") return row.adpHalf;
  return row.adpPpr;
}

const TE_BONUS_PER_REC: Record<TeScoringFormat, number> = {
  NONE: 0,
  HALF: 0.5,
  FULL: 1,
};

// Client-side twin of convex/scoring.ts's bonusPoints/pointsForScoringConfig
// (same duplication convention already used above for pointsForScoring/
// adpForScoring) - TE-only reception bonus and/or the +2/passing-TD bump
// that turns the baked-in 4pt TD into 6, computed from each row's raw
// per-category stats blob since Sleeper has no precomputed column for
// either.
export function bonusPoints(
  row: { position: Position; stats: Record<string, number> },
  config: ScoringConfig,
): number {
  let bonus = 0;
  if (row.position === "TE") {
    bonus += (row.stats.rec ?? 0) * TE_BONUS_PER_REC[config.teScoring];
  }
  if (config.sixPointPassTds) {
    bonus += (row.stats.pass_td ?? 0) * 2;
  }
  return bonus;
}

export function pointsForScoringConfig(
  row: {
    position: Position;
    pointsStd: number;
    pointsHalf: number;
    pointsPpr: number;
    stats: Record<string, number>;
  },
  config: ScoringConfig,
): number {
  return pointsForScoring(row, config.scoring) + bonusPoints(row, config);
}

// Derives a ScoringConfig from a seasons doc - mirrors convex/scoring.ts's
// scoringConfigFromSeason. teScoring/sixPointPassTds are absent on seasons
// created before this feature shipped; absent means NONE/off (the
// pre-feature behavior).
export function scoringConfigFromSeason(season: {
  scoring: ScoringFormat;
  teScoring?: TeScoringFormat;
  sixPointPassTds?: boolean;
}): ScoringConfig {
  return {
    scoring: season.scoring,
    teScoring: season.teScoring ?? "NONE",
    sixPointPassTds: season.sixPointPassTds ?? false,
  };
}

// Sleeper's player pool includes thousands of practice-squad/deep-bench
// players with no real draft relevance. Sleeper's own "no real ADP"
// sentinel (999) doesn't actually catch these - its community ADP has a
// long tail of technically-non-999-but-still-noise values (a QB drafted
// once in some obscure deep dynasty startup still isn't relevant), so this
// is a real rank ceiling instead: top 350 overall by ADP is roughly the
// depth of even a large/deep redraft league. DST never gets a real ADP from
// Sleeper at all, but it's already naturally capped at exactly 32 (one per
// team), so it needs no filtering.
export const RELEVANT_ADP_CEILING = 350;

export interface PositionedRow {
  fpid: number;
  position: Position;
}

// Trim the thousands of practice-squad/deep-bench players Sleeper returns
// down to actually draft-relevant ones: real ADP for skill positions, any
// DST (already naturally capped at 32 - one per team), or K filtered by
// projected points instead of ADP (Sleeper never gives K a real ADP either,
// but unlike DST there are far more than 32). `getPoints` is a callback
// rather than requiring the full pointsStd/Half/Ppr triple on T, since some
// callers (e.g. draft.board.getDraftBoard rows) only carry one
// already-scoring-resolved `points` field.
export function filterRelevantPlayers<T extends PositionedRow>(
  rows: T[],
  activePositions: Position[],
  scoring: ScoringFormat,
  adpByFpid: Map<number, { adpStd: number; adpHalf: number; adpPpr: number }>,
  getPoints: (row: T) => number,
): T[] {
  return rows.filter((row) => {
    if (!activePositions.includes(row.position)) return false;
    if (row.position === "DST") return true;
    if (row.position === "K") return getPoints(row) > 0;
    const adp = adpByFpid.get(row.fpid);
    return (
      adp !== undefined && adpForScoring(adp, scoring) < RELEVANT_ADP_CEILING
    );
  });
}
