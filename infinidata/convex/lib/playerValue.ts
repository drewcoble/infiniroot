import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { POSITIONS } from "../positions";
import { bonusPoints, pointsForScoringConfig, type ScoringConfig } from "../scoring";

type Position = (typeof POSITIONS)[number];

// Shared "how good is this player right now" machinery - originally built
// for convex/lib/faab.ts's FAAB bid suggestions, extracted here once
// convex/rosVor.ts needed the exact same recency/volume-adjusted momentum
// read and injury-boost detection for its own (much broader - every
// rosterable player, not just free agents) ranking. Both callers still own
// their own downstream use of this (FAAB's per-team demand pricing vs.
// rosVor's global replacement-level rank) - only the player-level value
// inputs are shared.

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// ---- Recency-weighted actual performance + volume ----
//
// Most-recent-week-first weights - re-normalized to however many of these
// weeks a player actually has rows for, so a rookie/practice-squad call-up
// with zero games in the window correctly reduces to "no usage history"
// (weightedAverage returns 0) rather than a partial/skewed average.
const RECENCY_WEEKS = 3;
const RECENCY_WEIGHTS = [3, 2, 1];

function weightedAverage(valuesNewestFirst: number[]): number {
  let weightedSum = 0;
  let weightTotal = 0;
  valuesNewestFirst.forEach((value, i) => {
    const weight = RECENCY_WEIGHTS[i] ?? 0;
    weightedSum += value * weight;
    weightTotal += weight;
  });
  return weightTotal > 0 ? weightedSum / weightTotal : 0;
}

// Position-relevant volume stat(s) from a playerPoints row's raw stats blob
// (see sleeper/playerPoints.ts's numericStats - every numeric Sleeper stat
// key is already captured, targets/carries/attempts included). K/DST have
// no meaningful "touches" concept, hence undefined.
function touchesForPosition(position: Position, stats: Record<string, number> | undefined): number | undefined {
  if (!stats) return undefined;
  switch (position) {
    case "QB":
      return stats.pass_att;
    case "RB":
      return (stats.rush_att ?? 0) + (stats.rec_tgt ?? 0);
    case "WR":
    case "TE":
      return stats.rec_tgt;
    default:
      return undefined;
  }
}

function snapShareForRow(stats: Record<string, number> | undefined): number | undefined {
  if (!stats || !stats.tm_off_snp) return undefined;
  return clamp((stats.off_snp ?? 0) / stats.tm_off_snp, 0, 1);
}

// One player's inputs to the value formula - built once per candidate from
// the batched reads in gatherPlayerForms, then reused for both the
// momentum multiplier and (for currently-injured teammates) the backup-
// boost detection below.
export interface PlayerForm {
  fpid: number;
  name: string;
  team: string | null;
  position: Position;
  // This week's projection, bonus-adjusted for the league's own scoring
  // config (TE premium / 6pt passing TDs) - the forward-looking baseline
  // rate everything else nudges up or down.
  currentWeekProjection: number;
  previousWeekProjection: number | null;
  weightedActualPPG: number;
  weightedSnapShare: number;
  weightedTouches: number | null;
  gamesInWindow: number;
}

// Batched, not per-player: one query per (position, week) covers every
// player at that position for that week, same pattern convex/draftValues.ts
// already used - O(positions * weeks) reads, not O(players). Deliberately
// still just the CURRENT week's projection (not every remaining week) to
// keep this bounded - a real per-week, bye-aware sum (like infinileague's
// power rankings does) would be more precise but multiplies the read cost
// by remainingWeeks; the momentum/volume adjustments below already fix the
// accuracy problem that mattered most for FAAB, so that's deferred rather
// than bundled into this pass.
export async function gatherPlayerForms(
  ctx: QueryCtx | MutationCtx,
  args: { activePositions: Position[]; week: string; scoringConfig: ScoringConfig },
): Promise<Map<number, PlayerForm>> {
  const forms = new Map<number, PlayerForm>();

  for (const pos of args.activePositions) {
    const projectionRows = await ctx.db
      .query("projections")
      .withIndex("by_position_week", (q) => q.eq("position", pos).eq("week", args.week))
      .collect();
    for (const row of projectionRows) {
      forms.set(row.fpid, {
        fpid: row.fpid,
        name: row.name,
        team: row.team,
        position: pos,
        currentWeekProjection: pointsForScoringConfig(row, args.scoringConfig),
        previousWeekProjection:
          row.previousPointsStd !== undefined
            ? pointsForScoringConfig(
                {
                  position: pos,
                  pointsStd: row.previousPointsStd,
                  pointsHalf: row.previousPointsHalf ?? row.previousPointsStd,
                  pointsPpr: row.previousPointsPpr ?? row.previousPointsStd,
                  stats: row.stats,
                },
                args.scoringConfig,
              )
            : null,
        weightedActualPPG: 0,
        weightedSnapShare: 0,
        weightedTouches: null,
        gamesInWindow: 0,
      });
    }
  }

  // Trailing weeks, newest first - "0" and negative weeks (pre-season/week
  // 1 has no history) are simply skipped, not clamped, so an early-season
  // player just gets a shorter (still correctly weighted) window.
  const currentWeekNum = Number(args.week);
  const recentWeeks = Array.from({ length: RECENCY_WEEKS }, (_, i) => currentWeekNum - 1 - i)
    .filter((w) => w >= 1)
    .map(String);

  const actualsByFpid = new Map<number, { points: number; snapShare: number | undefined; touches: number | undefined }[]>();
  for (const week of recentWeeks) {
    for (const pos of args.activePositions) {
      const rows = await ctx.db
        .query("playerPoints")
        .withIndex("by_position_week", (q) => q.eq("position", pos).eq("week", week))
        .collect();
      for (const row of rows) {
        if (row.scoring !== args.scoringConfig.scoring) continue;
        // A row with gp explicitly 0 is a tracked-but-didn't-play week
        // (bye, inactive) - same convention playerSeasonStats already uses
        // for "0-point week = didn't play" - excluded from the window
        // rather than counted as a real (bad) game.
        if (row.stats?.gp === 0) continue;
        const points = row.points + bonusPoints({ position: pos, stats: row.stats ?? {} }, args.scoringConfig);
        const list = actualsByFpid.get(row.fpid) ?? [];
        list.push({ points, snapShare: snapShareForRow(row.stats), touches: touchesForPosition(pos, row.stats) });
        actualsByFpid.set(row.fpid, list);
      }
    }
  }

  for (const [fpid, weeks] of actualsByFpid) {
    const existing = forms.get(fpid);
    if (!existing) continue; // not projected this week (e.g. long-term IR) - no baseline to adjust
    const snapShares = weeks.map((w) => w.snapShare).filter((v): v is number => v !== undefined);
    const touches = weeks.map((w) => w.touches).filter((v): v is number => v !== undefined);
    existing.weightedActualPPG = weightedAverage(weeks.map((w) => w.points));
    existing.weightedSnapShare = snapShares.length > 0 ? weightedAverage(snapShares) : 0;
    existing.weightedTouches = touches.length > 0 ? weightedAverage(touches) : null;
    existing.gamesInWindow = weeks.length;
  }

  return forms;
}

// How much a recent points surprise (actual beating or missing projection)
// should move the forward rate, scaled by how much recent volume backs it
// up - a hot game on real snaps/touches is trusted; a hot game on a
// handful of touches is mostly noise and gets damped back toward the
// projection. VOLUME_CONFIDENCE_SNAP_SHARE is "the snap share at which we
// fully trust the surprise" - both this and the [MIN,MAX] band are starting
// guesses, not calibrated against real outcomes yet.
const VOLUME_CONFIDENCE_SNAP_SHARE = 0.5;
const MOMENTUM_MIN = 0.7;
const MOMENTUM_MAX = 1.4;

export function momentumMultiplier(form: PlayerForm): number {
  if (form.gamesInWindow === 0 || form.currentWeekProjection <= 0) return 1;
  const surprise = form.weightedActualPPG / form.currentWeekProjection;
  const confidence = clamp(form.weightedSnapShare / VOLUME_CONFIDENCE_SNAP_SHARE, 0, 1);
  return clamp(1 + 0.5 * (surprise - 1) * confidence, MOMENTUM_MIN, MOMENTUM_MAX);
}

export function forwardRate(form: PlayerForm): number {
  return Math.max(form.currentWeekProjection * momentumMultiplier(form), 0);
}

// ---- Injury-driven backup boost ----
//
// A backup's own projection/usage may not have caught up to a teammate's
// injury yet (Sleeper's own injury_status field typically lags the real
// event by 1-3+ days) - this estimates a temporary elevated rate using the
// INJURED player's own recent production as a proxy for "what a full
// workload here is worth", time-boxed to however long the injury is
// expected to last. irWeeks (schema.ts's injuries table) would be the
// principled source for that duration but has never actually been
// populated by any fetch path - this falls back to a status-based default
// table plus a keyword scan of the injury comment for obvious season-
// ending language, both flagged as approximations to revisit once/if
// irWeeks is wired up for real.
const DEFAULT_BOOST_WEEKS_BY_STATUS: Record<string, number> = {
  Questionable: 1,
  Doubtful: 1,
  Out: 1,
  IR: 4,
  PUP: 4,
  "Non-Football Injury": 4,
};
const SEASON_ENDING_KEYWORDS = [
  "torn acl",
  "torn achilles",
  "torn pectoral",
  "ruptured",
  "out for the season",
  "out for season",
  "season-ending",
  "season ending",
];
const SEASON_ENDING_BOOST_WEEKS = 10;

// How recent an injurySnapshots entry has to be to still count as "fresh" -
// past this, assume the market (and our own projections) have already
// priced it in, so the boost stops applying on its own rather than lasting
// forever.
const BOOST_FRESHNESS_MS = 9 * 24 * 60 * 60 * 1000;
const USAGE_HISTORY_SNAP_SHARE_FLOOR = 0.15;
const PROJECTION_SPIKE_RATIO = 1.5;
const PROJECTION_SPIKE_ABSOLUTE = 4;
// A backup stepping into a starter's workload rarely matches what the
// starter was actually producing - this is a blunt discount on the
// injured player's own recent rate, not a per-player skill estimate.
const HANDCUFF_PRODUCTION_FACTOR = 0.65;

export interface InjuryBoost {
  boostedWeeks: number;
  boostedRate: number;
  reason: string;
}

function estimatedBoostWeeks(status: string, comment: string): number {
  const lowerComment = comment.toLowerCase();
  if (SEASON_ENDING_KEYWORDS.some((kw) => lowerComment.includes(kw))) {
    return SEASON_ENDING_BOOST_WEEKS;
  }
  return DEFAULT_BOOST_WEEKS_BY_STATUS[status] ?? 0;
}

// Currently-injured teammates at the SAME position/team become eligible via
// either: (a) usage-history path - they already have a real trailing snap
// share, so we trust it's their role now the incumbent is out; or (b)
// projection-spike path - no usage history (a true zero-usage handcuff/
// practice-squad promotion), but today's projection just jumped vs.
// yesterday's (previousPointsX), meaning the projection system itself has
// caught up. Both require the injury itself to be recent (BOOST_FRESHNESS_MS)
// so this fades once the news is stale, rather than boosting a handcuff for
// the rest of the season regardless of what's happened since.
export async function findInjuryBoosts(
  ctx: QueryCtx | MutationCtx,
  args: { forms: Map<number, PlayerForm> },
): Promise<Map<number, InjuryBoost>> {
  const boosts = new Map<number, InjuryBoost>();

  const activeStatuses = new Set(Object.keys(DEFAULT_BOOST_WEEKS_BY_STATUS));
  const injuredRows = await ctx.db.query("injuries").collect();
  const now = Date.now();

  for (const injured of injuredRows) {
    if (!activeStatuses.has(injured.status)) continue;
    const injuredForm = args.forms.get(injured.fpid);
    if (!injuredForm) continue; // no team/position to match teammates against

    const latestSnapshot = await ctx.db
      .query("injurySnapshots")
      .withIndex("by_fpid", (q) => q.eq("fpid", injured.fpid))
      .order("desc")
      .first();
    if (!latestSnapshot || now - latestSnapshot.fetchedAt > BOOST_FRESHNESS_MS) continue;

    const boostedWeeks = estimatedBoostWeeks(injured.status, injured.comment);
    if (boostedWeeks <= 0) continue;
    const boostedRate = Math.max(injuredForm.weightedActualPPG, injuredForm.currentWeekProjection) * HANDCUFF_PRODUCTION_FACTOR;
    if (boostedRate <= 0) continue;

    for (const candidate of args.forms.values()) {
      if (candidate.fpid === injured.fpid) continue;
      if (candidate.team !== injuredForm.team || candidate.position !== injuredForm.position) continue;

      const hasUsageHistory = candidate.weightedSnapShare >= USAGE_HISTORY_SNAP_SHARE_FLOOR;
      const spiked =
        candidate.previousWeekProjection !== null &&
        candidate.currentWeekProjection > candidate.previousWeekProjection * PROJECTION_SPIKE_RATIO &&
        candidate.currentWeekProjection - candidate.previousWeekProjection > PROJECTION_SPIKE_ABSOLUTE;
      if (!hasUsageHistory && !spiked) continue;

      // Multiple injured teammates at the same spot (rare) - keep whichever
      // gives the bigger boost rather than stacking them.
      const existing = boosts.get(candidate.fpid);
      if (existing && existing.boostedRate >= boostedRate) continue;
      boosts.set(candidate.fpid, {
        boostedWeeks,
        boostedRate,
        reason: `${injuredForm.name} (${injured.statusShort}) - likely to see expanded role`,
      });
    }
  }

  return boosts;
}

// ---- Replacement level among currently-available free agents ----

export interface ValuedPlayer {
  fpid: number;
  name: string;
  team: string | null;
  position: Position;
  rosValue: number;
}

// Same tiered demand curve (non-flex starter demand, then a pooled FLEX
// tier, then a pooled SUPERFLEX tier) convex/draftValues.ts's
// computeDraftValuesForSettings uses to find the "still on the board"
// replacement level pre-draft, just fed the free-agent-only pool ranked by
// rosValue instead of the whole draftable pool ranked by season points -
// "the next player up if this slot opens," for both FAAB's tiebreak
// ranking and rosVor's own valueOverReplacement.
export function computeReplacementLevels(
  settings: Doc<"seasons">,
  activePositions: Position[],
  freeAgentsByPosition: Map<Position, ValuedPlayer[]>,
): Record<Position, number> {
  const nonFlexDemand = {} as Record<Position, number>;
  for (const pos of activePositions) {
    nonFlexDemand[pos] = Math.max(settings.teamCount * settings.rosterSlots[pos], 0);
  }

  const flexCandidates: Array<{ position: Position; value: number }> = [];
  for (const pos of settings.flexPositions) {
    const sorted = freeAgentsByPosition.get(pos) ?? [];
    for (const row of sorted.slice(nonFlexDemand[pos] ?? 0)) {
      flexCandidates.push({ position: pos, value: row.rosValue });
    }
  }
  flexCandidates.sort((a, b) => b.value - a.value);
  const flexDemand = settings.teamCount * settings.rosterSlots.FLEX;
  const flexWonCount = new Map<Position, number>();
  for (const candidate of flexCandidates.slice(0, flexDemand)) {
    flexWonCount.set(candidate.position, (flexWonCount.get(candidate.position) ?? 0) + 1);
  }

  const superflexCandidates: Array<{ position: Position; value: number }> = [];
  for (const pos of settings.superflexPositions) {
    const sorted = freeAgentsByPosition.get(pos) ?? [];
    const alreadyClaimed = (nonFlexDemand[pos] ?? 0) + (flexWonCount.get(pos) ?? 0);
    for (const row of sorted.slice(alreadyClaimed)) {
      superflexCandidates.push({ position: pos, value: row.rosValue });
    }
  }
  superflexCandidates.sort((a, b) => b.value - a.value);
  const superflexDemand = settings.teamCount * settings.rosterSlots.SUPERFLEX;
  const superflexWonCount = new Map<Position, number>();
  for (const candidate of superflexCandidates.slice(0, superflexDemand)) {
    superflexWonCount.set(candidate.position, (superflexWonCount.get(candidate.position) ?? 0) + 1);
  }

  const replacement = {} as Record<Position, number>;
  for (const pos of activePositions) {
    const sorted = freeAgentsByPosition.get(pos) ?? [];
    const rank = (nonFlexDemand[pos] ?? 0) + (flexWonCount.get(pos) ?? 0) + (superflexWonCount.get(pos) ?? 0) + 1;
    const row = sorted[rank - 1] ?? sorted[sorted.length - 1];
    replacement[pos] = row?.rosValue ?? 0;
  }
  return replacement;
}
