// A league's DST "allowed" scoring - the points/yards-allowed tiers every
// provider scores a defense by (e.g. "0 points allowed = 10", "14-20 = 1").
// infinileague's live DST projection needs them: a defense's score starts
// at the top tier and drops as the offense it faces moves the ball, so
// once its opponent has scored, how much of the pregame projection is
// still reachable depends on exactly where the league's tier lines sit
// (see infinileague's src/lib/liveGames.ts, which mirrors these types).

// Inclusive on both ends; max null means open-ended ("35+").
export interface AllowedTier {
  min: number;
  max: number | null;
  points: number;
}

export interface DstAllowedScoring {
  pointsTiers: AllowedTier[];
  yardsTiers: AllowedTier[];
}

function sortTiers(tiers: AllowedTier[]): AllowedTier[] {
  return tiers.sort((a, b) => a.min - b.min);
}

// Both empty means this league's settings had no allowed tiers we could
// read - callers treat that as "unknown" rather than "scores nothing".
export function hasAllowedTiers(scoring: DstAllowedScoring): boolean {
  return scoring.pointsTiers.length > 0 || scoring.yardsTiers.length > 0;
}

// Sleeper's scoring_settings keys: pts_allow_0, pts_allow_1_6, ...,
// pts_allow_35p and yds_allow_0_100, ..., yds_allow_550p (the same keys
// its stats payloads flag a defense's tier with).
const SLEEPER_TIER_KEY = /^(pts|yds)_allow_(\d+)(?:_(\d+)|(p))?$/;

export function sleeperDstScoring(
  scoringSettings: Record<string, number | undefined> | undefined,
): DstAllowedScoring {
  const pointsTiers: AllowedTier[] = [];
  const yardsTiers: AllowedTier[] = [];
  for (const [key, points] of Object.entries(scoringSettings ?? {})) {
    const match = SLEEPER_TIER_KEY.exec(key);
    if (!match || typeof points !== "number" || points === 0) continue;
    const min = Number(match[2]);
    const max = match[3] !== undefined ? Number(match[3]) : match[4] ? null : min;
    (match[1] === "pts" ? pointsTiers : yardsTiers).push({ min, max, points });
  }
  return { pointsTiers: sortTiers(pointsTiers), yardsTiers: sortTiers(yardsTiers) };
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
// ESPN's D/ST lineup slot - allowed-tier items score only through this
// slot's override (their base `points` is 0).
const ESPN_DST_SLOT = "16";

export function espnDstScoring(
  scoringItems:
    | Array<{ statId: number; points: number; pointsOverrides?: Record<string, number> }>
    | undefined,
): DstAllowedScoring {
  const pointsTiers: AllowedTier[] = [];
  const yardsTiers: AllowedTier[] = [];
  for (const item of scoringItems ?? []) {
    const points = item.pointsOverrides?.[ESPN_DST_SLOT] ?? item.points;
    if (points === 0) continue;
    const pointsRange = ESPN_POINTS_TIERS[item.statId];
    const yardsRange = ESPN_YARDS_TIERS[item.statId];
    if (pointsRange) pointsTiers.push({ min: pointsRange[0], max: pointsRange[1], points });
    if (yardsRange) yardsTiers.push({ min: yardsRange[0], max: yardsRange[1], points });
  }
  return { pointsTiers: sortTiers(pointsTiers), yardsTiers: sortTiers(yardsTiers) };
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

export function sortAllowedTiers(scoring: DstAllowedScoring): DstAllowedScoring {
  return { pointsTiers: sortTiers(scoring.pointsTiers), yardsTiers: sortTiers(scoring.yardsTiers) };
}
