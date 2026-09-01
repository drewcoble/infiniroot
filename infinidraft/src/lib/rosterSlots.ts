import type { Position } from "../types";

export interface RosterSlotCounts {
  QB: number;
  RB: number;
  WR: number;
  TE: number;
  DST: number;
  K: number;
  FLEX: number;
  SUPERFLEX: number;
  BENCH: number;
}

export interface SlotDescriptor {
  key: string;
  label: string;
  // null for FLEX/SUPERFLEX/BENCH - those slots aren't tied to one fixed
  // position, just eligibility rules.
  position: Position | null;
}

const SLOT_ORDER: Array<{
  countKey: keyof RosterSlotCounts;
  label: string;
  position: Position | null;
}> = [
  { countKey: "QB", label: "QB", position: "QB" },
  { countKey: "SUPERFLEX", label: "SFLEX", position: null },
  { countKey: "RB", label: "RB", position: "RB" },
  { countKey: "WR", label: "WR", position: "WR" },
  { countKey: "FLEX", label: "FLEX", position: null },
  { countKey: "TE", label: "TE", position: "TE" },
  { countKey: "DST", label: "DST", position: "DST" },
  { countKey: "K", label: "K", position: "K" },
  { countKey: "BENCH", label: "BN", position: null },
];

// Whether every roster slot, league-wide, has been filled - used to gate
// in-season tooling (see AppHeader.tsx's Season mode switch) without needing
// a dedicated "draft status" field: a completed draft is just one where
// picksCount has caught up to the full roster size for every team.
export function isDraftComplete(
  rosterSlots: RosterSlotCounts,
  teamCount: number,
  picksCount: number,
): boolean {
  return picksCount >= expandRosterSlots(rosterSlots).length * teamCount;
}

// Deterministic, ordered slot list for a league's roster shape - kept in
// sync with convex/draft/slots.ts (Convex's bundler doesn't allow importing
// across the convex/ boundary, so this is duplicated rather than shared,
// matching how pointsForScoring is already duplicated between
// convex/scoring.ts and PlayersTable.tsx). The single source of truth for
// budget-plan keys and draftPicks.planSlotKey. A slot with count 1
// keys/labels as e.g. "QB"; counts above 1 number each instance ("RB1",
// "RB2", ...).
export function expandRosterSlots(
  rosterSlots: RosterSlotCounts,
): SlotDescriptor[] {
  const slots: SlotDescriptor[] = [];
  for (const { countKey, label, position } of SLOT_ORDER) {
    const count = rosterSlots[countKey];
    if (count <= 0) continue;
    if (count === 1) {
      slots.push({ key: label, label, position });
    } else {
      for (let i = 1; i <= count; i++) {
        slots.push({ key: `${label}${i}`, label: `${label}${i}`, position });
      }
    }
  }
  return slots;
}
