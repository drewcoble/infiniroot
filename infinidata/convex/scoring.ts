import { v } from "convex/values";
import { POSITIONS } from "./positions";

type Position = (typeof POSITIONS)[number];

export const scoringValidator = v.union(
  v.literal("STD"),
  v.literal("HALF"),
  v.literal("PPR"),
);

export type Scoring = "STD" | "HALF" | "PPR";

export function pointsForScoring(
  row: { pointsStd: number; pointsHalf: number; pointsPpr: number },
  scoring: Scoring,
): number {
  if (scoring === "STD") return row.pointsStd;
  if (scoring === "HALF") return row.pointsHalf;
  return row.pointsPpr;
}

export function adpForScoring(
  row: { adpStd: number; adpHalf: number; adpPpr: number },
  scoring: Scoring,
): number {
  if (scoring === "STD") return row.adpStd;
  if (scoring === "HALF") return row.adpHalf;
  return row.adpPpr;
}

export const teScoringValidator = v.union(
  v.literal("NONE"),
  v.literal("HALF"),
  v.literal("FULL"),
);

export type TeScoring = "NONE" | "HALF" | "FULL";

export const scoringConfigValidator = v.object({
  scoring: scoringValidator,
  teScoring: teScoringValidator,
  sixPointPassTds: v.boolean(),
});

export interface ScoringConfig {
  scoring: Scoring;
  teScoring: TeScoring;
  sixPointPassTds: boolean;
}

const TE_BONUS_PER_REC: Record<TeScoring, number> = {
  NONE: 0,
  HALF: 0.5,
  FULL: 1,
};

// Base fantasy points (4pt passing TDs, no TE premium - both layered on
// separately by bonusPoints below) from a raw per-category stats blob, for
// any provider - see convex/projectionBlending.ts, which runs this over
// each provider's own raw stats before averaging the results together.
// Coefficients were reverse-engineered from Sleeper's own pts_std/
// pts_half_ppr/pts_ppr and confirmed to reproduce them exactly (Josh Allen,
// Ja'Marr Chase, 2026 season projections - see PR history), so running
// Sleeper's own stats back through this function is a no-op versus trusting
// its precomputed columns directly, the way this app did before multi-
// provider blending existed. Two-point conversions aren't included - no
// ESPN stat id could be reliably identified for them (rare enough, <1% of a
// typical season total, that omitting them is an accepted gap rather than
// blocking on it).
export function computeProjectedPoints(stats: Record<string, number>): {
  pointsStd: number;
  pointsHalf: number;
  pointsPpr: number;
} {
  const base =
    (stats.pass_yd ?? 0) * 0.04 +
    (stats.pass_td ?? 0) * 4 +
    (stats.pass_int ?? 0) * -1 +
    (stats.rush_yd ?? 0) * 0.1 +
    (stats.rush_td ?? 0) * 6 +
    (stats.rec_yd ?? 0) * 0.1 +
    (stats.rec_td ?? 0) * 6 +
    (stats.fum_lost ?? 0) * -2;
  const rec = stats.rec ?? 0;
  return {
    pointsStd: base,
    pointsHalf: base + rec * 0.5,
    pointsPpr: base + rec * 1,
  };
}

// Extra points beyond the base STD/HALF/PPR columns above - TE-only
// reception bonus and/or the +2/passing-TD bump that turns the already-
// baked-in 4pt TD into 6. Computed here from each row's raw per-category
// stats blob (see sleeper/projections.ts's numericStats, which keeps "rec"
// and "pass_td" alongside every other raw stat key) rather than folded into
// computeProjectedPoints, since it's this app's own scoring config, not a
// property of any provider's data. Always additive on top of
// pointsForScoring, never a replacement for it.
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

// pointsForScoring (Sleeper's baseline) plus this app's TE premium / 6pt
// passing TD bonus on top - the function every points-producing call site
// should use instead of calling pointsForScoring directly, now that scoring
// has dimensions Sleeper doesn't supply a precomputed column for.
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

// Derives a ScoringConfig from a seasons doc. teScoring/sixPointPassTds are
// v.optional (existing seasons rows predate this feature) - absent means
// NONE/off (the pre-feature behavior), NOT "absent means enabled" the way
// seasons.useKeepers works, since every league that existed before this
// shipped was implicitly playing with no bonus.
export function scoringConfigFromSeason(season: {
  scoring: Scoring;
  teScoring?: TeScoring;
  sixPointPassTds?: boolean;
}): ScoringConfig {
  return {
    scoring: season.scoring,
    teScoring: season.teScoring ?? "NONE",
    sixPointPassTds: season.sixPointPassTds ?? false,
  };
}
