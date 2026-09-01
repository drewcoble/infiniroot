import type { SlotLabel, TeamRosterRow } from "../types/season";

type DedicatedPosition = "QB" | "RB" | "WR" | "TE" | "DST" | "K";

const DEDICATED_POSITIONS: DedicatedPosition[] = ["QB", "RB", "WR", "TE", "DST", "K"];
const FLEX_ELIGIBLE: DedicatedPosition[] = ["RB", "WR", "TE"];
const SUPERFLEX_ELIGIBLE: DedicatedPosition[] = ["QB", "RB", "WR", "TE"];
const STARTING_SLOTS: SlotLabel[] = [...DEDICATED_POSITIONS, "FLEX", "SUPERFLEX"];

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

function takeTop(pool: Candidate[], count: number, used: Set<number>): Candidate[] {
  const picked = [...pool]
    .sort((a, b) => b.projectedPoints - a.projectedPoints)
    .slice(0, count);
  for (const candidate of picked) used.add(candidate.fpid);
  return picked;
}

// First-pass, projections-only lineup advice: builds the points-optimal
// starting lineup for this same roster (same tiered greedy approach as
// infinidraft's own convex/infinidraft/draft/lineupOptimizer.ts - dedicated
// positions first by projected points, then a pooled FLEX tier, then a
// pooled SUPERFLEX tier) and diffs it against the actual Sleeper-reported
// starters (TeamRosterRow.slot, already computed by teamRoster.ts). Only
// ever draws candidates from rows already starting or on the bench - taxi/
// IR players are excluded, since Sleeper wouldn't let you start them
// either. Returns nothing if there's no slot data to diff against (team
// isn't Sleeper-linked) or the actual lineup is already optimal.
//
// Diffed at the whole-lineup level (not diffed independently per slot
// group) deliberately: a player who's merely reassigned between two
// starting slot types (e.g. a dedicated WR bumped into the WR-eligible
// FLEX pool by a stronger incoming WR) is a starter in both the actual and
// optimal sets and shouldn't generate a contradictory "sit this WR" /
// "start this WR" pair - only real bench<->starter moves are surfaced.
export function buildLineupSuggestions(rows: TeamRosterRow[]): LineupSuggestion[] {
  const slotCounts = new Map<SlotLabel, number>();
  const actualStarters = new Map<number, Candidate & { slot: SlotLabel }>();
  const eligiblePool: Candidate[] = [];

  for (const row of rows) {
    const isStartingSlot = row.slot !== undefined && STARTING_SLOTS.includes(row.slot);
    const candidate = toCandidate(row);

    if (isStartingSlot) {
      const slot = row.slot as SlotLabel;
      slotCounts.set(slot, (slotCounts.get(slot) ?? 0) + 1);
      if (candidate) actualStarters.set(candidate.fpid, { ...candidate, slot });
    }

    if (candidate && (isStartingSlot || row.slot === "BENCH")) {
      eligiblePool.push(candidate);
    }
  }

  // No starting-slot rows at all means this team isn't Sleeper-linked (see
  // teamRoster.ts's fallback path) - nothing to build a lineup diff from.
  if (slotCounts.size === 0) return [];

  const used = new Set<number>();
  const optimalStarters = new Map<number, Candidate & { slot: SlotLabel }>();

  for (const position of DEDICATED_POSITIONS) {
    const count = slotCounts.get(position) ?? 0;
    if (count === 0) continue;
    const candidates = eligiblePool.filter((c) => c.position === position && !used.has(c.fpid));
    for (const picked of takeTop(candidates, count, used)) {
      optimalStarters.set(picked.fpid, { ...picked, slot: position });
    }
  }

  const flexCount = slotCounts.get("FLEX") ?? 0;
  if (flexCount > 0) {
    const candidates = eligiblePool.filter(
      (c) => !used.has(c.fpid) && FLEX_ELIGIBLE.includes(c.position),
    );
    for (const picked of takeTop(candidates, flexCount, used)) {
      optimalStarters.set(picked.fpid, { ...picked, slot: "FLEX" });
    }
  }

  const superflexCount = slotCounts.get("SUPERFLEX") ?? 0;
  if (superflexCount > 0) {
    const candidates = eligiblePool.filter(
      (c) => !used.has(c.fpid) && SUPERFLEX_ELIGIBLE.includes(c.position),
    );
    for (const picked of takeTop(candidates, superflexCount, used)) {
      optimalStarters.set(picked.fpid, { ...picked, slot: "SUPERFLEX" });
    }
  }

  const shouldStart = [...optimalStarters.values()]
    .filter((c) => !actualStarters.has(c.fpid))
    .sort((a, b) => b.projectedPoints - a.projectedPoints);
  const shouldSit = [...actualStarters.values()]
    .filter((c) => !optimalStarters.has(c.fpid))
    .sort((a, b) => a.projectedPoints - b.projectedPoints);

  // shouldStart.length >= shouldSit.length in virtually every real case -
  // the optimal set fills every slot it can (>= however many the actual
  // lineup happens to have filled), so any length mismatch is extra
  // "starting an empty slot" entries, not the reverse. The rare inverse
  // (a position with fewer eligible players than slots) just drops the
  // leftover shouldSit entries rather than surfacing a sit-only suggestion.
  return shouldStart.map((start, i) => {
    const sit = shouldSit[i];
    return sit ? { start, sit } : { start };
  });
}
