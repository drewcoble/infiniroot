import { POSITIONS } from "../positions";
import { Scoring, adpForScoring } from "../scoring";

type Position = (typeof POSITIONS)[number];

// Mirrors src/lib/relevantPlayers.ts's RELEVANT_ADP_CEILING (the frontend's
// overall-relevance filter). Duplicated rather than imported: convex/ never
// depends on src/ (see convex/scoring.ts's pointsForScoring, which mirrors
// that same file's helper instead of importing it). A real rank ceiling
// rather than Sleeper's own "no real ADP" 999 sentinel - top 350 overall is
// roughly the depth of even a large/deep redraft league; 999 lets through a
// long tail of technically-non-999-but-still-noise ADP values.
export const RELEVANT_ADP_CEILING = 350;

// A player starts a new tier once their composite score drops below this
// fraction of the *current tier's leader* (not the overall #1, and not just
// the previous player - see the anchor-reset logic below). Tunable like
// FALLOFF_EXPONENT in draftValues.ts - lower tolerates more relative decline
// per tier (fewer, wider tiers), higher splits more aggressively (more,
// narrower tiers).
//
// This resets-to-tier-leader design (rather than comparing only to the
// previous player, or using a step-to-step statistical gap threshold) is
// deliberate: a position can decline gradually with no single big jump (e.g.
// QBs dropping a few points at a time) and still cover a huge total spread.
// Comparing every player back to the top of their own tier bounds each
// tier's internal spread directly, so a slow bleed can't silently
// accumulate into one mega-tier the way step-to-step gap detection did.
const TIER_PCT_THRESHOLD = 0.875;

// A relative-only threshold gets more sensitive as scores shrink: near the
// bottom of a position's pool (below replacement level, where $ value has
// floored at $1 and stopped discriminating), tiny absolute differences in
// points/ADP are already a large fraction of a small anchor, so tiers
// fragment into a long tail of 1-2 player groups. Requiring the absolute
// drop to also clear this floor keeps that tail from splintering, while
// leaving real cliffs (which clear it easily) untouched. Also tunable.
const MIN_ABSOLUTE_GAP = 0.03;

export interface TierInput {
  fpid: number;
  position: Position;
  points: number;
  dollarValue: number;
}

export interface TierResult {
  tier: number;
  tierLabel: string;
  tierRank: number;
}

interface AdpRow {
  adpStd: number;
  adpHalf: number;
  adpPpr: number;
}

// Min-max normalize to [0, 1], where 1 = this position's best value on this
// metric - the scale a "% of the tier leader" comparison needs. A metric
// with no spread (every relevant player identical) normalizes everyone to 1
// rather than dividing by zero, since nobody's actually behind anybody on it.
function normalize(values: number[]): number[] {
  if (values.length === 0) return [];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (hi === lo) return values.map(() => 1);
  return values.map((v) => (v - lo) / (hi - lo));
}

/**
 * Blends ADP + projected points + $ value into one composite [0, 1] signal
 * per player (1 = this position's best on that blend), then breaks tiers
 * wherever a player's composite score falls below TIER_PCT_THRESHOLD of the
 * player currently leading their tier - rather than at a fixed rank cutoff,
 * so two players who are genuinely close in value land in the same tier
 * regardless of which side of a rank boundary they happen to fall on.
 *
 * Also determines tierRank: the blended-signal order. Callers that care
 * about tier grouping should sort by tierRank (not raw points or $ value)
 * so tiers render as contiguous groups - see PlayersLeftTab.tsx.
 *
 * Deep-bench players with no real ADP (Sleeper's 999 sentinel, or DST/K
 * which never get a real one) are excluded from clustering entirely and
 * dumped into one trailing tier, the same way today's rank-cutoff scheme
 * implicitly collapsed everyone past its last breakpoint into one tier.
 */
export function computeTiers(
  rows: TierInput[],
  adpByFpid: Map<number, AdpRow>,
  scoring: Scoring,
): Map<number, TierResult> {
  const result = new Map<number, TierResult>();

  const byPosition = new Map<Position, TierInput[]>();
  for (const row of rows) {
    const list = byPosition.get(row.position) ?? [];
    list.push(row);
    byPosition.set(row.position, list);
  }

  for (const [position, positionRows] of byPosition) {
    const relevant: Array<{ row: TierInput; adp: number | undefined }> = [];
    const irrelevant: TierInput[] = [];

    for (const row of positionRows) {
      if (position === "DST") {
        relevant.push({ row, adp: undefined });
      } else if (position === "K") {
        if (row.points > 0) relevant.push({ row, adp: undefined });
        else irrelevant.push(row);
      } else {
        const adpRow = adpByFpid.get(row.fpid);
        const adp = adpRow ? adpForScoring(adpRow, scoring) : undefined;
        if (adp !== undefined && adp < RELEVANT_ADP_CEILING) {
          relevant.push({ row, adp });
        } else {
          irrelevant.push(row);
        }
      }
    }

    let tier = 1;
    let tierRank = 1;

    if (relevant.length > 0) {
      const hasAdp = relevant.some((r) => r.adp !== undefined);
      const pointsNorm = normalize(relevant.map((r) => r.row.points));
      const dollarNorm = normalize(relevant.map((r) => r.row.dollarValue));
      // Lower ADP is better, so normalize its negation - the best (lowest)
      // ADP then lands at 1, same "higher is better" direction as the other
      // two metrics.
      const adpNorm = hasAdp
        ? normalize(relevant.map((r) => (r.adp !== undefined ? -r.adp : 0)))
        : null;

      // pointsNorm/dollarNorm/adpNorm are each built via .map over
      // `relevant`, so they're guaranteed to have exactly relevant.length
      // entries - the non-null assertions below are safe by construction.
      const composite = relevant.map((_, i) => {
        const parts = [pointsNorm[i]!, dollarNorm[i]!];
        if (adpNorm) parts.push(adpNorm[i]!);
        return parts.reduce((sum, v) => sum + v, 0) / parts.length;
      });

      const order = relevant
        .map((r, i) => ({ fpid: r.row.fpid, score: composite[i]! }))
        .sort((a, b) => b.score - a.score);

      // The tier's leader anchors the threshold - reset every time a new
      // tier starts, not fixed to the position's overall #1.
      let anchor = order[0]!.score;
      for (let i = 0; i < order.length; i++) {
        const player = order[i]!;
        if (
          i > 0 &&
          player.score < anchor * TIER_PCT_THRESHOLD &&
          anchor - player.score >= MIN_ABSOLUTE_GAP
        ) {
          tier++;
          anchor = player.score;
        }
        result.set(player.fpid, {
          tier,
          tierLabel: `Tier ${tier}`,
          tierRank: tierRank++,
        });
      }
    }

    const irrelevantTier = relevant.length > 0 ? tier + 1 : 1;
    for (const row of irrelevant) {
      result.set(row.fpid, {
        tier: irrelevantTier,
        tierLabel: `Tier ${irrelevantTier}`,
        tierRank: tierRank++,
      });
    }
  }

  return result;
}
