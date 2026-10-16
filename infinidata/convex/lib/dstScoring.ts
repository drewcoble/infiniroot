// A league's own DST scoring - the points/yards-allowed tiers every
// provider scores a defense by (e.g. "0 points allowed = 10", "14-20 = 1")
// plus what each play is worth (sack, takeaway, return TD, ...).
// infinileague's Matchup tab scores DST projections with it (see
// dstProjection below and its src/lib/liveGames.ts, which mirrors these
// types and the expected-tier math): our projections table only carries
// Sleeper's default-scored pts_std, which in a league with richer DST
// scoring (a 16-point shutout tier, 1.5-point sacks) badly understates a
// defense - and makes its live projection drift away from its actual score.
//
// Deliberately NOT part of a season's scoring config (scoring/teScoring/
// sixPointPassTds): every rosVOR/projection/value table is keyed by that
// config, and DST scoring varies far too freely between leagues to add as
// another key. It's read from the provider's own settings on each roster
// load instead, and only ever applied to that roster's rows.

// Inclusive on both ends; max null means open-ended ("35+").
export interface AllowedTier {
  min: number;
  max: number | null;
  points: number;
}

export interface DstScoring {
  pointsTiers: AllowedTier[];
  yardsTiers: AllowedTier[];
  // Points per play, keyed by the Sleeper stat key our DST projections'
  // stats use (sack, int, fum_rec, def_td, ...). Empty when the provider's
  // play values couldn't be read - dstProjection then keeps the plays
  // share of Sleeper's own projection.
  playValues: Record<string, number>;
}

function sortTiers(tiers: AllowedTier[]): AllowedTier[] {
  return tiers.sort((a, b) => a.min - b.min);
}

export function sortDstScoring(scoring: DstScoring): DstScoring {
  return {
    ...scoring,
    pointsTiers: sortTiers(scoring.pointsTiers),
    yardsTiers: sortTiers(scoring.yardsTiers),
  };
}

// No tiers means this league's settings had none we could read - callers
// treat that as "unknown" (and leave the DST on Sleeper's projection)
// rather than "scores nothing for points allowed".
export function hasAllowedTiers(scoring: DstScoring): boolean {
  return scoring.pointsTiers.length > 0 || scoring.yardsTiers.length > 0;
}

// The DST play stats Sleeper projects (see a DEF projection's stats) that
// a league can score. Sleeper's own scoring_settings use these same keys;
// ESPN/Yahoo ids are mapped onto them below. def_td already counts
// pass_int_td + def_fum_td and st_td counts def_kr_td + def_pr_td - a
// provider that scores the parts (ESPN) maps to those instead, never both.
const DST_PLAY_KEYS = new Set([
  "sack",
  "int",
  "fum_rec",
  "ff",
  "safe",
  "blk_kick",
  "def_td",
  "st_td",
  "pass_int_td",
  "def_fum_td",
  "def_kr_td",
  "def_pr_td",
  "tkl_loss",
  "def_kr_yd",
  "def_pr_yd",
]);

// Sleeper's scoring_settings keys: pts_allow_0, pts_allow_1_6, ...,
// pts_allow_35p and yds_allow_0_100, ..., yds_allow_550p (the same keys
// its stats payloads flag a defense's tier with).
const SLEEPER_TIER_KEY = /^(pts|yds)_allow_(\d+)(?:_(\d+)|(p))?$/;

export function sleeperDstScoring(
  scoringSettings: Record<string, number | undefined> | undefined,
): DstScoring {
  const scoring: DstScoring = { pointsTiers: [], yardsTiers: [], playValues: {} };
  for (const [key, points] of Object.entries(scoringSettings ?? {})) {
    if (typeof points !== "number" || points === 0) continue;
    if (DST_PLAY_KEYS.has(key)) {
      scoring.playValues[key] = points;
      continue;
    }
    const match = SLEEPER_TIER_KEY.exec(key);
    if (!match) continue;
    const min = Number(match[2]);
    const max = match[3] !== undefined ? Number(match[3]) : match[4] ? null : min;
    (match[1] === "pts" ? scoring.pointsTiers : scoring.yardsTiers).push({ min, max, points });
  }
  return sortDstScoring(scoring);
}

// ESPN's stat ids for each allowed tier - confirmed against public league
// 164483's settings (ESPN's own defaults: 89 = 5, 90 = 4, 91 = 3, 92 = 1,
// 123 = -1, ... and 128 = 5 for under 100 yards). Tiers worth 0 by default
// (18-21, 22-27, 300-349 yards) aren't listed by that league, so their ids
// come from ESPN's stat table rather than a live sighting.
const ESPN_POINTS_TIERS: Record<number, [number, number | null]> = {
  89: [0, 0],
  90: [1, 6],
  91: [7, 13],
  92: [14, 17],
  121: [18, 21],
  122: [22, 27],
  123: [28, 34],
  124: [35, 45],
  125: [46, null],
};
const ESPN_YARDS_TIERS: Record<number, [number, number | null]> = {
  128: [0, 99],
  129: [100, 199],
  130: [200, 299],
  131: [300, 349],
  132: [350, 399],
  133: [400, 449],
  134: [450, 499],
  135: [500, 549],
  136: [550, null],
};
// ESPN's D/ST play stat ids -> our projection keys. 95-99 and 101-104 are
// all present in league 164483 with ESPN's default values (INT/FR/blocked
// kick/safety 2, sack 1, return TDs 6); 103 vs 104 (interception vs fumble
// return TD) is per ESPN's stat table - both default to 6, so a mix-up
// would only matter in a league that scores them differently. 106 (forced
// fumble) isn't scored by default.
const ESPN_PLAY_KEYS: Record<number, string> = {
  95: "int",
  96: "fum_rec",
  97: "blk_kick",
  98: "safe",
  99: "sack",
  101: "def_kr_td",
  102: "def_pr_td",
  103: "pass_int_td",
  104: "def_fum_td",
  106: "ff",
};
// ESPN's D/ST lineup slot - D/ST items score through this slot's override
// (an allowed tier's base `points` is 0).
const ESPN_DST_SLOT = "16";

export function espnDstScoring(
  scoringItems:
    | Array<{ statId: number; points: number; pointsOverrides?: Record<string, number> }>
    | undefined,
): DstScoring {
  const scoring: DstScoring = { pointsTiers: [], yardsTiers: [], playValues: {} };
  for (const item of scoringItems ?? []) {
    const points = item.pointsOverrides?.[ESPN_DST_SLOT] ?? item.points;
    if (points === 0) continue;
    const pointsRange = ESPN_POINTS_TIERS[item.statId];
    const yardsRange = ESPN_YARDS_TIERS[item.statId];
    const playKey = ESPN_PLAY_KEYS[item.statId];
    if (pointsRange) {
      scoring.pointsTiers.push({ min: pointsRange[0], max: pointsRange[1], points });
    }
    if (yardsRange) scoring.yardsTiers.push({ min: yardsRange[0], max: yardsRange[1], points });
    if (playKey) scoring.playValues[playKey] = points;
  }
  return sortDstScoring(scoring);
}

// Range out of a stat label like "Points Allowed 14-20 points", "Pts Allow
// 35+" or "Points Allowed 0 points" - for providers (Yahoo) whose tiers are
// only identifiable by name. undefined when the label carries no range
// (a plain per-point "Points Allowed" stat).
export function parseAllowedRange(label: string): { min: number; max: number | null } | undefined {
  const range = /(\d+)\s*-\s*(\d+)/.exec(label);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  const openEnded = /(\d+)\s*\+/.exec(label);
  if (openEnded) return { min: Number(openEnded[1]), max: null };
  const single = /\b(\d+)\b/.exec(label);
  if (single) return { min: Number(single[1]), max: Number(single[1]) };
  return undefined;
}

// Sleeper's default points-allowed tiers - what our projections' pts_std
// is scored with, so the plays share of it can be backed out when a
// league's own play values couldn't be read. Its default yards-allowed
// tiers are all 0.
const SLEEPER_DEFAULT_POINTS_TIERS: AllowedTier[] = [
  { min: 0, max: 0, points: 10 },
  { min: 1, max: 6, points: 7 },
  { min: 7, max: 13, points: 4 },
  { min: 14, max: 20, points: 1 },
  { min: 21, max: 27, points: 0 },
  { min: 28, max: 34, points: -1 },
  { min: 35, max: null, points: -4 },
];

// Full-game points/yards a defense allows - roughly the league average,
// for a projection fetched before Sleeper's own projected values were kept.
const FALLBACK_POINTS_ALLOWED = 22;
const FALLBACK_YARDS_ALLOWED = 330;
// How far a real game strays from the projected allowed totals - one
// standard deviation over a full game. Mirrored by infinileague's
// liveGames.ts, which shrinks it with the square root of what's left.
const POINTS_ALLOWED_SD = 10;
const YARDS_ALLOWED_SD = 75;

function tierPoints(tiers: AllowedTier[], allowed: number): number {
  const tier = tiers.find(
    (candidate) => allowed >= candidate.min && (candidate.max === null || allowed <= candidate.max),
  );
  return tier?.points ?? 0;
}

// Standard normal CDF (Abramowitz-Stegun 7.1.26, error < 1.5e-7).
function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

// Expected tier points for a full game's allowed total taken as
// normal(mean, sd), floored at zero (a pregame-only version of liveGames.ts's
// expectedTierPoints, which also handles a total already partly allowed).
// Tiers are whole numbers, hence the ±0.5.
function expectedTierPoints(tiers: AllowedTier[], mean: number, sd: number): number {
  const cdf = (total: number) => normalCdf((total - mean) / sd);
  return tiers.reduce((sum, tier) => {
    const low = tier.min <= 0 ? 0 : cdf(tier.min - 0.5);
    const high = tier.max === null ? 1 : cdf(tier.max + 0.5);
    return sum + tier.points * Math.max(high - low, 0);
  }, 0);
}

export interface DstProjection {
  projectedPoints: number;
  // The plays share of projectedPoints - everything but the allowed tiers.
  projectedPlays: number;
  projectedPointsAllowed: number;
  projectedYardsAllowed: number;
}

// One DST's pregame projection in its league's own scoring: Sleeper's
// projected plays at the league's play values, plus the expected allowed-
// tier points over a spread of outcomes around Sleeper's projected points/
// yards allowed (rather than just the tier the projected total lands in -
// 19 projected points allowed is a real chance at the 7-13 tier and the
// 21-27 one, not a sure 14-20).
export function dstProjection(
  scoring: DstScoring,
  stats: Record<string, number> | undefined,
  sleeperProjectedPoints: number,
): DstProjection {
  const projectedPointsAllowed = stats?.pts_allow ?? FALLBACK_POINTS_ALLOWED;
  const projectedYardsAllowed = stats?.yds_allow ?? FALLBACK_YARDS_ALLOWED;
  const scoredPlays = Object.entries(scoring.playValues);
  const projectedPlays =
    scoredPlays.length > 0
      ? scoredPlays.reduce((sum, [key, value]) => sum + (stats?.[key] ?? 0) * value, 0)
      : Math.max(
          sleeperProjectedPoints - tierPoints(SLEEPER_DEFAULT_POINTS_TIERS, projectedPointsAllowed),
          0,
        );
  const projectedPoints =
    projectedPlays +
    expectedTierPoints(scoring.pointsTiers, projectedPointsAllowed, POINTS_ALLOWED_SD) +
    expectedTierPoints(scoring.yardsTiers, projectedYardsAllowed, YARDS_ALLOWED_SD);
  return {
    projectedPoints,
    projectedPlays,
    projectedPointsAllowed,
    projectedYardsAllowed,
  };
}
