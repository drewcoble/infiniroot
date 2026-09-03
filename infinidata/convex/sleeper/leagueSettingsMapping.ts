import { POSITIONS } from "../positions";
import type { Scoring } from "../scoring";

type Position = (typeof POSITIONS)[number];

export interface MappedRosterSlots {
  rosterSlots: {
    QB: number;
    RB: number;
    WR: number;
    TE: number;
    DST: number;
    K: number;
    FLEX: number;
    SUPERFLEX: number;
    BENCH: number;
  };
  // infinidraft's flex/superflex eligibility is league-wide, not per-slot, so any
  // FLEX-shaped slot just turns on the standard RB/WR/TE (or QB/RB/WR/TE)
  // eligibility set rather than trying to derive an exact eligibility list
  // per slot code (Sleeper's WRRB_FLEX is narrower than FLEX, for instance -
  // this simplification treats both the same).
  flexPositions: Position[];
  superflexPositions: Position[];
  // Roster position codes Sleeper returned that have no equivalent slot in
  // this app's model (e.g. "IR", "TAXI") - surfaced so the import preview UI
  // can tell the user their real roster is larger than what got imported,
  // rather than silently under-counting.
  droppedSlots: string[];
}

// Sleeper's roster_positions is a flat array with one entry per slot,
// repeated per count (e.g. two RB slots -> "RB" appears twice) - counted
// down into this app's count-based RosterSlotCounts shape. Verify against a
// live league's `roster_positions` field while implementing the rest of
// Part 4/Yahoo - the codes below are from general knowledge of Sleeper's
// API, not a confirmed live response.
// Exported for convex/infinileague/season/teamRoster.ts's per-starter slot labeling
// (which starting slot each starters[] index actually occupies) - same
// translation table, different consumer (that one needs the per-code
// category, not the aggregated counts mapRosterPositions below produces).
export const SLOT_CODE_MAP: Record<
  string,
  keyof MappedRosterSlots["rosterSlots"] | "FLEX" | "SUPERFLEX"
> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  DEF: "DST",
  K: "K",
  FLEX: "FLEX",
  WRRB_FLEX: "FLEX",
  REC_FLEX: "FLEX",
  SUPER_FLEX: "SUPERFLEX",
  BN: "BENCH",
};

export function mapRosterPositions(rosterPositions: string[]): MappedRosterSlots {
  const rosterSlots: MappedRosterSlots["rosterSlots"] = {
    QB: 0,
    RB: 0,
    WR: 0,
    TE: 0,
    DST: 0,
    K: 0,
    FLEX: 0,
    SUPERFLEX: 0,
    BENCH: 0,
  };
  const droppedSlots = new Set<string>();

  for (const code of rosterPositions) {
    const mapped = SLOT_CODE_MAP[code];
    if (!mapped) {
      droppedSlots.add(code);
      continue;
    }
    rosterSlots[mapped] += 1;
  }

  return {
    rosterSlots,
    flexPositions: rosterSlots.FLEX > 0 ? ["RB", "WR", "TE"] : [],
    superflexPositions:
      rosterSlots.SUPERFLEX > 0 ? ["QB", "RB", "WR", "TE"] : [],
    droppedSlots: [...droppedSlots],
  };
}

// Nearest-bucket match against infinidraft's fixed STD/HALF/PPR trio using
// points-per-reception - infinidraft's own projections data only ever exists in
// these three formats, so a league with genuinely custom scoring (bonus
// yardage thresholds, etc.) can't be represented exactly regardless of which
// bucket this picks.
export function mapScoringSettings(
  scoringSettings: { rec?: number } | undefined,
): Scoring {
  const rec = scoringSettings?.rec ?? 0;
  if (rec >= 0.75) return "PPR";
  if (rec >= 0.25) return "HALF";
  return "STD";
}
