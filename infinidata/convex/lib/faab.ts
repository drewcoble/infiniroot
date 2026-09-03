import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { POSITIONS } from "../positions";
import { bonusPoints, pointsForScoringConfig, type ScoringConfig, scoringConfigFromSeason } from "../scoring";
import { expandRosterSlots, isEligibleForSlot } from "./rosterSlots";

type Position = (typeof POSITIONS)[number];

export interface FaabSuggestionRow {
  fpid: number;
  name: string;
  team: string | null;
  position: Position;
  rosValue: number;
  positionRank: number;
  // Demand across the whole league, not just the requester - how many teams
  // have a real roster gap this player would fill, and the single largest
  // gap among them (a rough "what would the winning bid look like" read).
  // 0/0 means nobody actually needs this player right now, whatever their
  // raw rosValue is - see computeFaabSuggestions' header comment for why
  // that's the point, not a bug.
  demandCount: number;
  topDemandValue: number;
  // myValue/suggestedBid/rationale are only populated when args.teamId is
  // given - the value/bid FROM THAT TEAM's own perspective and own
  // remaining budget, never a share of the league's combined FAAB (see
  // this file's header comment for why the old model did that and why it
  // was wrong).
  myValue: number | null;
  suggestedBid: number | null;
  rationale: string | null;
  // Set when this row's value includes an injury-driven backup boost (see
  // findInjuryBoosts) - surfaced so the UI can explain an otherwise-
  // surprising number rather than just asserting it.
  boostReason: string | null;
}

export interface FaabSuggestionsResult {
  week: string | null;
  season: string | null;
  remainingWeeks: number;
  suggestions: FaabSuggestionRow[];
}

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
interface PlayerForm {
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
// and the original computePlayerValues already used - O(positions * weeks)
// reads, not O(players). Deliberately still just the CURRENT week's
// projection (not every remaining week) to keep this bounded the same way
// the original formula was - a real per-week, bye-aware sum (like
// infinileague's power rankings does) would be more precise but multiplies
// the read cost by remainingWeeks; the momentum/volume adjustments below
// already fix the accuracy problem that mattered most (see this file's
// header), so that's deferred rather than bundled into this pass.
async function gatherPlayerForms(
  ctx: QueryCtx,
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
  // free agent just gets a shorter (still correctly weighted) window.
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

function momentumMultiplier(form: PlayerForm): number {
  if (form.gamesInWindow === 0 || form.currentWeekProjection <= 0) return 1;
  const surprise = form.weightedActualPPG / form.currentWeekProjection;
  const confidence = clamp(form.weightedSnapShare / VOLUME_CONFIDENCE_SNAP_SHARE, 0, 1);
  return clamp(1 + 0.5 * (surprise - 1) * confidence, MOMENTUM_MIN, MOMENTUM_MAX);
}

function forwardRate(form: PlayerForm): number {
  return Math.max(form.currentWeekProjection * momentumMultiplier(form), 0);
}

// ---- Injury-driven backup boost ----
//
// A backup's own projection/usage may not have caught up to a teammate's
// injury yet (see this file's header comment on the Monday-morning timing
// problem) - this estimates a temporary elevated rate using the INJURED
// player's own recent production as a proxy for "what a full workload here
// is worth", time-boxed to however long the injury is expected to last.
// irWeeks (schema.ts's injuries table) would be the principled source for
// that duration but has never actually been populated by any fetch path -
// this falls back to a status-based default table plus a keyword scan of
// the injury comment for obvious season-ending language, both flagged as
// approximations to revisit once/if irWeeks is wired up for real.
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

interface InjuryBoost {
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
async function findInjuryBoosts(
  ctx: QueryCtx,
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

// ---- Demand against every team's real rosters ----

interface ValuedPlayer {
  fpid: number;
  name: string;
  team: string | null;
  position: Position;
  rosValue: number;
}

// Greedy best-players-start slot assignment: highest rest-of-season value
// first, each assigned to the first slot (in expandRosterSlots' fixed
// priority order - exact position, then SFLEX, then FLEX, then BENCH) it's
// eligible for. Good enough to identify "this team's current starter at
// position X" - not exposed anywhere else, so it doesn't need to match the
// live-draft slot assignment exactly.
function assignRosterSlots(roster: ValuedPlayer[], settings: Doc<"seasons">): Map<string, ValuedPlayer> {
  const slots = expandRosterSlots(settings.rosterSlots);
  const assigned = new Map<string, ValuedPlayer>();
  const takenSlotKeys = new Set<string>();
  const sorted = [...roster].sort((a, b) => b.rosValue - a.rosValue);
  for (const player of sorted) {
    const slot = slots.find(
      (s) => !takenSlotKeys.has(s.key) && isEligibleForSlot(player.position, s, settings.flexPositions, settings.superflexPositions),
    );
    if (!slot) continue;
    takenSlotKeys.add(slot.key);
    assigned.set(slot.key, player);
  }
  return assigned;
}

function weakestStarterByPosition(assignedSlots: Map<string, ValuedPlayer>): Partial<Record<Position, number>> {
  const weakest: Partial<Record<Position, number>> = {};
  for (const [slotKey, player] of assignedSlots) {
    if (slotKey.startsWith("BN")) continue;
    const current = weakest[player.position];
    if (current === undefined || player.rosValue < current) {
      weakest[player.position] = player.rosValue;
    }
  }
  return weakest;
}

// How much of MY OWN value to actually offer, scaled by competitive
// pressure from other teams that also have a gap here - no competing team
// means I can lowball far below my own valuation; a rival valuing this
// player as much or more than me means I likely need to approach my own
// ceiling to win it. Starting curve, not calibrated against real bid
// outcomes yet.
function competitionFraction(myValue: number, rivalDemandValues: number[]): number {
  if (myValue <= 0) return 0;
  const competingRivals = rivalDemandValues.filter((v) => v > 0);
  if (competingRivals.length === 0) return 0.15;
  const strongestRival = Math.max(...competingRivals);
  const pressure = Math.min(strongestRival / myValue, 1);
  const rivalCountBump = Math.min((competingRivals.length - 1) * 0.05, 0.15);
  return Math.min(0.15 + 0.7 * pressure + rivalCountBump, 0.9);
}

// Advisory FAAB bid suggestions for every current free agent.
//
// Replaces an earlier version of this formula that was a near-copy of the
// draft-day auction engine (convex/draftValues.ts): same VOR-over-
// replacement idea, same weight-and-split-a-pot allocation. That's wrong
// for FAAB - a live auction really is one shared pot split in real time,
// but FAAB is independent blind bidding from each team's own budget, so a
// player should only carry value where a specific team has a specific gap,
// priced against THAT team's own remaining budget - never a share of the
// league's combined FAAB. This version instead: (1) values each player off
// a recency/volume-aware momentum read on top of their forward projection
// rather than a flat season-to-date average, (2) adds a time-boxed value
// bump for a free agent plausibly inheriting a just-injured teammate's
// workload, (3) computes demand by comparing that value against every
// team's own actual current weakest starter, and (4) prices a suggested
// bid off the requesting team's own value and budget, scaled by how much
// competing demand exists elsewhere in the league.
//
// Lives here rather than directly in convex/infinileague/season/faabValues.ts
// (its only consumer, now that infinidraft's own Free Agents tab has moved
// to infinileague) since it's still generic library logic, not
// infinileague-specific - kept out of that app's folder the same way
// convex/lib/rosterSlots.ts is.
export async function computeFaabSuggestions(
  ctx: QueryCtx,
  args: {
    seasonId: Id<"seasons">;
    teamId?: Id<"seasonTeams"> | undefined;
    position?: Position | undefined;
  },
): Promise<FaabSuggestionsResult> {
  const settings = await ctx.db.get(args.seasonId);
  if (!settings) {
    throw new Error("League not found.");
  }

  const nflState = await ctx.db.query("nflState").first();
  if (!nflState || nflState.seasonType !== "regular") {
    return { week: null, season: null, remainingWeeks: 0, suggestions: [] };
  }
  const remainingWeeks = Math.max(18 - Number(nflState.week) + 1, 0);

  const activePositions = POSITIONS.filter(
    (pos) => settings.rosterSlots[pos] > 0 || settings.flexPositions.includes(pos) || settings.superflexPositions.includes(pos),
  );
  const scoringConfig = scoringConfigFromSeason(settings);

  const [rosteredRows, teams, forms] = await Promise.all([
    ctx.db
      .query("rosterPlayers")
      .withIndex("by_season", (q) => q.eq("seasonId", args.seasonId))
      .collect(),
    ctx.db
      .query("seasonTeams")
      .withIndex("by_season", (q) => q.eq("seasonId", args.seasonId))
      .collect(),
    gatherPlayerForms(ctx, { activePositions, week: nflState.week, scoringConfig }),
  ]);
  const rosteredFpidsByTeam = new Map<Id<"seasonTeams">, Set<number>>();
  const rosteredFpids = new Set<number>();
  for (const row of rosteredRows) {
    rosteredFpids.add(row.fpid);
    const set = rosteredFpidsByTeam.get(row.teamId) ?? new Set<number>();
    set.add(row.fpid);
    rosteredFpidsByTeam.set(row.teamId, set);
  }

  const boosts = await findInjuryBoosts(ctx, { forms });

  function valueOf(fpid: number, applyBoost: boolean): ValuedPlayer | null {
    const form = forms.get(fpid);
    if (!form) return null;
    let rosValue = forwardRate(form) * remainingWeeks;
    if (applyBoost) {
      const boost = boosts.get(fpid);
      if (boost) {
        const boostedWeeks = Math.min(boost.boostedWeeks, remainingWeeks);
        const ownRate = forwardRate(form);
        rosValue += Math.max(boost.boostedRate - ownRate, 0) * boostedWeeks;
      }
    }
    return { fpid: form.fpid, name: form.name, team: form.team, position: form.position, rosValue };
  }

  // Every team's current starters, valued the same way as free agents
  // (minus the injury boost, which only makes sense for a player a team
  // doesn't have yet) - this is what demand gets computed against below.
  const weakestStarterByTeam = new Map<Id<"seasonTeams">, Partial<Record<Position, number>>>();
  for (const team of teams) {
    const roster = [...(rosteredFpidsByTeam.get(team._id) ?? [])]
      .map((fpid) => valueOf(fpid, false))
      .filter((v): v is ValuedPlayer => v !== null);
    weakestStarterByTeam.set(team._id, weakestStarterByPosition(assignRosterSlots(roster, settings)));
  }

  const freeAgentsByPosition = new Map<Position, ValuedPlayer[]>();
  for (const pos of activePositions) {
    const rows = [...forms.values()]
      .filter((form) => form.position === pos && !rosteredFpids.has(form.fpid))
      .map((form) => valueOf(form.fpid, true))
      .filter((v): v is ValuedPlayer => v !== null)
      .sort((a, b) => b.rosValue - a.rosValue);
    freeAgentsByPosition.set(pos, rows);
  }

  const requestingTeam = args.teamId ? teams.find((team) => team._id === args.teamId) : undefined;
  const remainingFaabForTeam = requestingTeam
    ? Math.max((requestingTeam.faabBudgetOverride ?? settings.faabBudget ?? 0) - (requestingTeam.faabSpent ?? 0), 0)
    : 0;

  const suggestions: FaabSuggestionRow[] = [];
  for (const pos of activePositions) {
    if (args.position && args.position !== pos) continue;
    const rows = freeAgentsByPosition.get(pos) ?? [];
    rows.forEach((row, index) => {
      const demandValuesByTeam = teams.map((team) => {
        const weakest = weakestStarterByTeam.get(team._id)?.[pos];
        return { teamId: team._id, value: Math.max(row.rosValue - (weakest ?? 0), 0) };
      });
      const demandCount = demandValuesByTeam.filter((d) => d.value > 0).length;
      const topDemandValue = demandValuesByTeam.reduce((max, d) => Math.max(max, d.value), 0);

      let myValue: number | null = null;
      let suggestedBid: number | null = null;
      let rationale: string | null = null;
      if (requestingTeam) {
        myValue = demandValuesByTeam.find((d) => d.teamId === requestingTeam._id)?.value ?? 0;
        const rivalDemands = demandValuesByTeam.filter((d) => d.teamId !== requestingTeam._id).map((d) => d.value);
        suggestedBid = Math.round(Math.min(myValue * competitionFraction(myValue, rivalDemands), remainingFaabForTeam));

        const weakest = weakestStarterByTeam.get(requestingTeam._id)?.[pos];
        if (myValue <= 0) {
          rationale = weakest === undefined ? `No rostered ${pos} on your team, but still no real upgrade` : `${pos} already well-staffed on your team`;
        } else if (weakest === undefined) {
          rationale = `No rostered ${pos} on your team right now`;
        } else {
          rationale = `Upgrades your current ${pos}`;
        }
      }

      const boost = boosts.get(row.fpid);
      if (boost) {
        rationale = rationale ? `${rationale} - ${boost.reason}` : boost.reason;
      }

      suggestions.push({
        fpid: row.fpid,
        name: row.name,
        team: row.team,
        position: pos,
        rosValue: row.rosValue,
        positionRank: index + 1,
        demandCount,
        topDemandValue,
        myValue,
        suggestedBid,
        rationale,
        boostReason: boost?.reason ?? null,
      });
    });
  }

  return {
    week: nflState.week,
    season: nflState.season,
    remainingWeeks,
    suggestions,
  };
}
