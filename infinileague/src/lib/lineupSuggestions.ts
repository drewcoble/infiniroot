import type { SlotLabel, TeamRosterRow } from "../types/season";

export type DedicatedPosition = "QB" | "RB" | "WR" | "TE" | "DST" | "K";

const DEDICATED_POSITIONS: DedicatedPosition[] = ["QB", "RB", "WR", "TE", "DST", "K"];
const FLEX_ELIGIBLE: DedicatedPosition[] = ["RB", "WR", "TE"];
const SUPERFLEX_ELIGIBLE: DedicatedPosition[] = ["QB", "RB", "WR", "TE"];
const STARTING_SLOTS: SlotLabel[] = [...DEDICATED_POSITIONS, "FLEX", "SUPERFLEX"];

// Generic pool entry fillOptimalLineup assigns into starting slots - just
// enough to run the tiered greedy fill (position + a single comparable
// value), independent of what that value actually measures.
// buildLineupSuggestions below uses weekly projectedPoints.
export interface LineupPoolEntry {
  fpid: number;
  position: DedicatedPosition;
  value: number;
}

function takeTop(pool: LineupPoolEntry[], count: number, used: Set<number>): LineupPoolEntry[] {
  const picked = [...pool].sort((a, b) => b.value - a.value).slice(0, count);
  for (const candidate of picked) used.add(candidate.fpid);
  return picked;
}

// Tiered greedy fill - dedicated positions first by value (a dedicated slot
// can only ever be filled by its own position, so there's no cross-position
// tradeoff to weigh there), then a pooled FLEX tier, then a pooled
// SUPERFLEX tier, each drawing from whatever's left over. Optimal for this
// slot structure: once dedicated slots have first claim on their own
// position's best players, the best remaining flex-eligible players are
// necessarily the correct FLEX picks, same for SUPERFLEX after that -
// same approach infinidraft's own convex/infinidraft/draft/lineupOptimizer.ts
// uses.
export function fillOptimalLineup(
  pool: LineupPoolEntry[],
  slotCounts: Map<SlotLabel, number>,
): Map<number, SlotLabel> {
  const used = new Set<number>();
  const assignments = new Map<number, SlotLabel>();

  for (const position of DEDICATED_POSITIONS) {
    const count = slotCounts.get(position) ?? 0;
    if (count === 0) continue;
    const candidates = pool.filter((c) => c.position === position && !used.has(c.fpid));
    for (const picked of takeTop(candidates, count, used)) {
      assignments.set(picked.fpid, position);
    }
  }

  const flexCount = slotCounts.get("FLEX") ?? 0;
  if (flexCount > 0) {
    const candidates = pool.filter((c) => !used.has(c.fpid) && FLEX_ELIGIBLE.includes(c.position));
    for (const picked of takeTop(candidates, flexCount, used)) {
      assignments.set(picked.fpid, "FLEX");
    }
  }

  const superflexCount = slotCounts.get("SUPERFLEX") ?? 0;
  if (superflexCount > 0) {
    const candidates = pool.filter(
      (c) => !used.has(c.fpid) && SUPERFLEX_ELIGIBLE.includes(c.position),
    );
    for (const picked of takeTop(candidates, superflexCount, used)) {
      assignments.set(picked.fpid, "SUPERFLEX");
    }
  }

  return assignments;
}

// How many of each starting slot type a roster's actual lineup carries -
// derived from TeamRosterRow.slot (already computed by teamRoster.ts from
// the league's real roster_positions), not a hardcoded league setting, so
// this reflects each team's own starting lineup shape (flex/superflex
// counts vary by league). Empty (size 0) when the team isn't Sleeper-linked
// (no slot data to count at all - see teamRoster.ts's fallback path).
export function extractSlotCounts(rows: TeamRosterRow[]): Map<SlotLabel, number> {
  const slotCounts = new Map<SlotLabel, number>();
  for (const row of rows) {
    if (row.slot === undefined || !STARTING_SLOTS.includes(row.slot)) continue;
    slotCounts.set(row.slot, (slotCounts.get(row.slot) ?? 0) + 1);
  }
  return slotCounts;
}

interface Candidate {
  fpid: number;
  name: string;
  position: DedicatedPosition;
  projectedPoints: number;
}

export interface LineupSuggestion {
  start: Candidate & { slot: SlotLabel };
  // Absent when `start` is filling a previously-empty slot rather than
  // displacing an actual current starter.
  sit?: Candidate & { slot: SlotLabel };
}

function toCandidate(row: TeamRosterRow): Candidate | null {
  if (row.fpid === undefined || row.name === undefined || row.position === undefined) {
    return null;
  }
  return {
    fpid: row.fpid,
    name: row.name,
    position: row.position,
    projectedPoints: row.projectedPoints ?? 0,
  };
}

// First-pass, projections-only lineup advice: builds the points-optimal
// starting lineup for this same roster via fillOptimalLineup above and
// diffs it against the actual Sleeper-reported starters (TeamRosterRow.slot,
// already computed by teamRoster.ts). Only ever draws candidates from rows
// already starting or on the bench - taxi/IR players are excluded, since
// Sleeper wouldn't let you start them either. Returns nothing if there's no
// slot data to diff against (team isn't Sleeper-linked) or the actual
// lineup is already optimal.
//
// Diffed at the whole-lineup level (not diffed independently per slot
// group) deliberately: a player who's merely reassigned between two
// starting slot types (e.g. a dedicated WR bumped into the WR-eligible
// FLEX pool by a stronger incoming WR) is a starter in both the actual and
// optimal sets and shouldn't generate a contradictory "sit this WR" /
// "start this WR" pair - only real bench<->starter moves are surfaced.
export function buildLineupSuggestions(rows: TeamRosterRow[]): LineupSuggestion[] {
  const slotCounts = extractSlotCounts(rows);
  // No starting-slot rows at all means this team isn't Sleeper-linked (see
  // teamRoster.ts's fallback path) - nothing to build a lineup diff from.
  if (slotCounts.size === 0) return [];

  const actualStarters = new Map<number, Candidate & { slot: SlotLabel }>();
  const candidatesByFpid = new Map<number, Candidate>();
  const eligiblePool: LineupPoolEntry[] = [];

  for (const row of rows) {
    const isStartingSlot = row.slot !== undefined && STARTING_SLOTS.includes(row.slot);
    const candidate = toCandidate(row);

    if (isStartingSlot && candidate) {
      actualStarters.set(candidate.fpid, { ...candidate, slot: row.slot as SlotLabel });
    }

    if (candidate && (isStartingSlot || row.slot === "BENCH")) {
      candidatesByFpid.set(candidate.fpid, candidate);
      eligiblePool.push({
        fpid: candidate.fpid,
        position: candidate.position,
        value: candidate.projectedPoints,
      });
    }
  }

  const optimalAssignments = fillOptimalLineup(eligiblePool, slotCounts);
  const optimalStarters = new Map<number, Candidate & { slot: SlotLabel }>();
  for (const [fpid, slot] of optimalAssignments) {
    const candidate = candidatesByFpid.get(fpid);
    if (candidate) optimalStarters.set(fpid, { ...candidate, slot });
  }

  const shouldStart = [...optimalStarters.values()]
    .filter((c) => !actualStarters.has(c.fpid))
    .sort((a, b) => b.projectedPoints - a.projectedPoints);
  const shouldSit = [...actualStarters.values()]
    .filter((c) => !optimalStarters.has(c.fpid))
    .sort((a, b) => a.projectedPoints - b.projectedPoints);

  // Pairs each should-start player with a should-sit player, preferring one
  // at the same real position - e.g. "start this QB, sit that QB" - over
  // whatever should-sit entry merely happens to land at the same index once
  // both lists are sorted by points. Index-pairing across positions reads as
  // two unrelated single-position swaps mashed into one confusing
  // cross-position suggestion (start a WR, sit a QB) even when a like-for-
  // like pairing was available. Only falls back to the next-lowest-points
  // remaining candidate, regardless of position, once no same-position
  // match is left in the pool.
  //
  // shouldStart.length >= shouldSit.length in virtually every real case -
  // the optimal set fills every slot it can (>= however many the actual
  // lineup happens to have filled), so any length mismatch is extra
  // "starting an empty slot" entries, not the reverse. The rare inverse
  // (a position with fewer eligible players than slots) just drops the
  // leftover shouldSit entries rather than surfacing a sit-only suggestion.
  const sitPool = [...shouldSit];
  return shouldStart.map((start) => {
    const samePositionIndex = sitPool.findIndex((c) => c.position === start.position);
    const sit =
      samePositionIndex !== -1 ? sitPool.splice(samePositionIndex, 1)[0] : sitPool.shift();
    return sit ? { start, sit } : { start };
  });
}
