import { POSITIONS } from "../positions";

type Position = (typeof POSITIONS)[number];

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

// Deterministic, ordered slot list for a league's roster shape - the single
// source of truth for budget-plan keys (draftBudgetPlans.amounts) and
// draftPicks.planSlotKey. A slot with count 1 keys/labels as e.g. "QB";
// counts above 1 number each instance ("RB1", "RB2", ...).
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

// Whether a player at `position` is allowed to sit in `slot` - an exact
// position match, a flex-eligible slot when the position is in
// flexPositions, a superflex-eligible slot when it's in superflexPositions,
// or any bench slot (bench takes anyone). Used by convex/lib/faab.ts
// to work out which of a synced roster's open slots a free agent could fill,
// and, in duplicate, by src/lib/slotAssignment.ts's UI-facing
// eligibleSlotsForPosition (see that file's comment on why it's duplicated
// rather than imported).
export function isEligibleForSlot(
  position: Position,
  slot: SlotDescriptor,
  flexPositions: readonly Position[],
  superflexPositions: readonly Position[],
): boolean {
  if (slot.position === position) return true;
  if (slot.label.startsWith("FLEX")) return flexPositions.includes(position);
  if (slot.label.startsWith("SFLEX")) {
    return superflexPositions.includes(position);
  }
  if (slot.label.startsWith("BN")) return true;
  return false;
}

// Whether every roster slot, league-wide, has been filled - server-side
// counterpart to src/lib/rosterSlots.ts's isDraftComplete (duplicated rather
// than imported, same as expandRosterSlots above - Convex's bundler doesn't
// allow importing across the convex/ boundary). Formula and argument order
// must match the client version exactly so the two never disagree; used by
// convex/infinidraft/draft/status.ts's syncDraftStatus to persist drafts.status.
//
// forfeitedSlotsCount (SNAKE_DRAFT.md §9) reduces the expected total - a
// team whose slot was forfeited in some round isn't expected to fill that
// roster spot via this draft at all (the assumption made in the plan doc:
// they'd backfill via waivers afterward, out of this app's scope), so the
// draft is "complete" with that many fewer total picks. Defaults to 0
// (today's exact behavior) for every auction league and every snake league
// with no forfeits.
export function isDraftComplete(
  rosterSlots: RosterSlotCounts,
  teamCount: number,
  picksCount: number,
  forfeitedSlotsCount = 0,
): boolean {
  return (
    picksCount >=
    expandRosterSlots(rosterSlots).length * teamCount - forfeitedSlotsCount
  );
}

// Greedily picks the best open roster slot for a newly-drafted player:
// prefer a slot dedicated to their exact position, then FLEX (if
// flex-eligible), then SUPERFLEX, then bench. Server-side port of
// src/lib/slotAssignment.ts's assignSlotForPick (duplicated, not imported -
// same convex/ bundler boundary as above), needed by the lineup optimizer's
// "actual" side (convex/infinidraft/draft/lineupOptimizer.ts) to reconstruct which slot
// each pick fills the same way the live UI does.
export function assignSlotForPick(
  position: Position,
  rosterSlots: RosterSlotCounts,
  filledSlotKeys: ReadonlySet<string>,
  flexPositions: readonly Position[],
  superflexPositions: readonly Position[],
): string | undefined {
  const openSlots = expandRosterSlots(rosterSlots).filter(
    (slot) => !filledSlotKeys.has(slot.key),
  );

  const exact = openSlots.find((slot) => slot.position === position);
  if (exact) return exact.key;

  if (flexPositions.includes(position)) {
    const flexSlot = openSlots.find((slot) => slot.label.startsWith("FLEX"));
    if (flexSlot) return flexSlot.key;
  }

  if (superflexPositions.includes(position)) {
    const superflexSlot = openSlots.find((slot) =>
      slot.label.startsWith("SFLEX"),
    );
    if (superflexSlot) return superflexSlot.key;
  }

  const benchSlot = openSlots.find((slot) => slot.label.startsWith("BN"));
  if (benchSlot) return benchSlot.key;

  return undefined;
}

// Replays a team's picks (in draft order) through assignSlotForPick to
// reconstruct which slot each one fills - a pick with an explicit
// planSlotKey always wins that slot outright; only picks with no stored (or
// a stale) assignment fall through to greedy auto-placement. Server-side
// port of src/lib/slotAssignment.ts's assignPicksToSlots (same duplication
// convention as above).
export function assignPicksToSlots<
  T extends { position: Position; planSlotKey?: string },
>(
  picksInSequenceOrder: readonly T[],
  rosterSlots: RosterSlotCounts,
  flexPositions: readonly Position[],
  superflexPositions: readonly Position[],
): Map<string, T> {
  const validSlotKeys = new Set(
    expandRosterSlots(rosterSlots).map((slot) => slot.key),
  );
  const bySlot = new Map<string, T>();
  const filled = new Set<string>();
  const unassigned: T[] = [];

  for (const pick of picksInSequenceOrder) {
    if (
      pick.planSlotKey &&
      validSlotKeys.has(pick.planSlotKey) &&
      !filled.has(pick.planSlotKey)
    ) {
      filled.add(pick.planSlotKey);
      bySlot.set(pick.planSlotKey, pick);
    } else {
      unassigned.push(pick);
    }
  }

  for (const pick of unassigned) {
    const slotKey = assignSlotForPick(
      pick.position,
      rosterSlots,
      filled,
      flexPositions,
      superflexPositions,
    );
    if (slotKey) {
      filled.add(slotKey);
      bySlot.set(slotKey, pick);
    }
  }
  return bySlot;
}
