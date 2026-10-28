import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { POSITIONS } from "../positions";
import { bonusPoints, pointsForScoring, pointsForScoringConfig, type ScoringConfig } from "../scoring";
import { isUsagePosition, projectedUsageScore } from "./usageScore";

type Position = (typeof POSITIONS)[number];

// Shared "how good is this player right now" machinery - originally built
// for convex/lib/faab.ts's FAAB bid suggestions, extracted here once
// convex/rosVor.ts needed the exact same recency/volume-adjusted momentum
// read and injured-teammate detection for its own (much broader - every
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
// momentum multiplier and (for currently-injured teammates) the injured-
// teammate note below.
export interface PlayerForm {
  fpid: number;
  name: string;
  team: string | null;
  position: Position;
  // This week's projection, bonus-adjusted for the league's own scoring
  // config (TE premium / 6pt passing TDs) - the forward-looking baseline
  // rate everything else nudges up or down.
  currentWeekProjection: number;
  // Same week's projection, but the plain scoring-config number with no
  // bonus adjustment - matches convex/infinileague/season/teamRoster.ts's
  // own projectedPoints exactly (same pointsStd/Half/Ppr pick, no
  // bonusPoints layered on). Only for display (rosVor.ts's weekPpg) so "This
  // Week" on the Players tab shows the identical number My Team already
  // shows for the same player/week - ranking still uses the momentum-
  // adjusted currentWeekProjection via forwardRate below.
  currentWeekProjectionRaw: number;
  // This week's projected usage score (lib/usageScore.ts) from the
  // projection's stat line - null for K/DST. Display only (rosVor.ts).
  currentWeekUsage: number | null;
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
  args: { activePositions: Position[]; week: string; season: string; scoringConfig: ScoringConfig },
): Promise<Map<number, PlayerForm>> {
  const forms = new Map<number, PlayerForm>();

  for (const pos of args.activePositions) {
    const projectionRows = await ctx.db
      .query("projections")
      .withIndex("by_position_week_fpid", (q) => q.eq("position", pos).eq("week", args.week))
      .collect();
    for (const row of projectionRows) {
      forms.set(row.fpid, {
        fpid: row.fpid,
        name: row.name,
        team: row.team,
        position: pos,
        currentWeekProjection: pointsForScoringConfig(row, args.scoringConfig),
        currentWeekProjectionRaw: pointsForScoring(row, args.scoringConfig.scoring),
        currentWeekUsage: isUsagePosition(pos) ? projectedUsageScore(row.stats, pos, args.scoringConfig) : null,
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
      // Scoped to args.season - playerWeekPoints keeps every past season's rows
      // around for history (see that table's own schema comment), so an
      // unscoped (position, week) read would pull a prior year's same-
      // numbered week's game right alongside the real current one.
      const rows = await ctx.db
        .query("playerWeekPoints")
        .withIndex("by_position_week_season", (q) => q.eq("position", pos).eq("week", week).eq("season", args.season))
        .collect();
      for (const row of rows) {
        // A row with gp explicitly 0 is a tracked-but-didn't-play week
        // (bye, inactive) - same convention playerSeasonStats already uses
        // for "0-point week = didn't play" - excluded from the window
        // rather than counted as a real (bad) game.
        if (row.stats?.gp === 0) continue;
        const points = pointsForScoring(row, args.scoringConfig.scoring) + bonusPoints({ position: pos, stats: row.stats }, args.scoringConfig);
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
// guesses, not calibrated against real outcomes yet. Narrowed from 0.7/1.4
// (too severe) to 0.9/1.1 (still a little much) to 0.95/1.05 after live
// review of each step, then to 0.98/1.02 - the multiplier scales a
// player's whole rest-of-season projection, and VOR (projection minus
// replacement) magnifies that several-fold for anyone near replacement
// level, which was moving trade values (infinivalue ranks by rosVor) more
// than a three-game sample should.
const VOLUME_CONFIDENCE_SNAP_SHARE = 0.5;
const MOMENTUM_MIN = 0.98;
const MOMENTUM_MAX = 1.02;

export function momentumMultiplier(form: PlayerForm): number {
  if (form.gamesInWindow === 0 || form.currentWeekProjection <= 0) return 1;
  const surprise = form.weightedActualPPG / form.currentWeekProjection;
  const confidence = clamp(form.weightedSnapShare / VOLUME_CONFIDENCE_SNAP_SHARE, 0, 1);
  return clamp(1 + 0.5 * (surprise - 1) * confidence, MOMENTUM_MIN, MOMENTUM_MAX);
}

export function forwardRate(form: PlayerForm): number {
  return Math.max(form.currentWeekProjection * momentumMultiplier(form), 0);
}

// ---- Injured-teammate note ----
//
// Flags a player whose same-position teammate just went down, so the
// free-agent list can say why they're worth a look. Note only - an earlier
// version also added a temporary "backup boost" to rosValue, removed
// 2026-10-22 pending re-evaluation (see git history for that version).
// Only Out and IR count - Questionable/Doubtful players usually still
// play, so their backups shouldn't be flagged.
const NOTE_STATUSES = new Set(["Out", "IR"]);
// How recent the injury's last real status change has to be - "placed on
// IR within the last week," and the same window for Out so a stale Out
// from an earlier week doesn't keep flagging his backup.
const NOTE_FRESHNESS_MS = 7 * 24 * 60 * 60 * 1000;
const USAGE_HISTORY_SNAP_SHARE_FLOOR = 0.15;
const PROJECTION_SPIKE_RATIO = 1.5;
const PROJECTION_SPIKE_ABSOLUTE = 4;

// Teammates at the SAME position/team as a freshly injured player qualify
// via either: (a) usage-history path - they already have a real trailing
// snap share, so they're plausibly next in line; or (b) projection-spike
// path - no usage history (a true zero-usage handcuff/practice-squad
// promotion), but today's projection just jumped vs. yesterday's
// (previousPointsX), meaning the projection system itself has caught up.
export async function findInjuredTeammateNotes(
  ctx: QueryCtx | MutationCtx,
  args: { forms: Map<number, PlayerForm> },
): Promise<Map<number, string>> {
  const notes = new Map<number, string>();

  const injuredRows = await ctx.db.query("injuries").collect();
  const now = Date.now();

  for (const injured of injuredRows) {
    if (!NOTE_STATUSES.has(injured.status)) continue;

    // When the injury started, not when it was last seen - a weekly
    // "carryForward" row (see the injurySnapshots schema comment) would
    // otherwise restart the freshness clock every week. Carry-forwards are
    // at most one per week, so this walk stays short.
    let latestChange: { fetchedAt: number } | null = null;
    for await (const snapshot of ctx.db
      .query("injurySnapshots")
      .withIndex("by_fpid_season", (q) => q.eq("fpid", injured.fpid))
      .order("desc")) {
      if (snapshot.kind === "carryForward") continue;
      latestChange = snapshot;
      break;
    }
    if (!latestChange || now - latestChange.fetchedAt > NOTE_FRESHNESS_MS) continue;

    // Long-term IR players often have no projection this week (so no form) -
    // fall back to the players table for team/position rather than
    // silently skipping their backups.
    const injuredForm = args.forms.get(injured.fpid);
    const injuredPlayer = injuredForm
      ? { name: injuredForm.name, team: injuredForm.team, position: injuredForm.position }
      : await ctx.db
          .query("players")
          .withIndex("by_fpid", (q) => q.eq("fpid", injured.fpid))
          .first();
    if (!injuredPlayer || injuredPlayer.team === null) continue;

    for (const candidate of args.forms.values()) {
      if (candidate.fpid === injured.fpid) continue;
      if (candidate.team !== injuredPlayer.team || candidate.position !== injuredPlayer.position) continue;

      const hasUsageHistory = candidate.weightedSnapShare >= USAGE_HISTORY_SNAP_SHARE_FLOOR;
      const spiked =
        candidate.previousWeekProjection !== null &&
        candidate.currentWeekProjection > candidate.previousWeekProjection * PROJECTION_SPIKE_RATIO &&
        candidate.currentWeekProjection - candidate.previousWeekProjection > PROJECTION_SPIKE_ABSOLUTE;
      if (!hasUsageHistory && !spiked) continue;

      // Multiple injured teammates at the same spot (rare) - first one wins.
      if (notes.has(candidate.fpid)) continue;
      notes.set(candidate.fpid, `${injuredPlayer.name} (${injured.statusShort}) - likely to see expanded role`);
    }
  }

  return notes;
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
  settings: Pick<Doc<"seasons">, "teamCount" | "flexPositions" | "superflexPositions"> & {
    rosterSlots: Record<Position | "FLEX" | "SUPERFLEX", number>;
  },
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
