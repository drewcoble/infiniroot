import type { Position } from "../types";
import {
  expandRosterSlots,
  type RosterSlotCounts,
  type SlotDescriptor,
} from "./rosterSlots";

// Greedily picks the best open roster slot for a newly-drafted player:
// prefer a slot dedicated to their exact position, then a FLEX slot (if
// they're flex-eligible), then SUPERFLEX, then bench - whichever comes
// first among slots not already filled. Computed once at the moment a pick
// is logged and stored as draftPicks.planSlotKey, rather than recomputed on
// every render, so a slot assignment doesn't shuffle around after later
// picks or an undo.
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
// reconstruct which slot each one most likely fills - but a pick with an
// explicit planSlotKey (self team only, auto-assigned at pick time for
// budget-plan reconciliation - see convex/draft/budgetAutoAdjust.ts) always
// wins that slot outright; only picks with no stored assignment (or a stale
// one - see the validSlotKeys check below) fall through to greedy
// auto-placement. This is the "what does this team still need"/budget-bucket
// view (DraftBoard's public TV board, nominationStrategies' team-needs
// signal, useTeamBudget) - not the starting-lineup display, which is always
// points-optimal and ignores planSlotKey entirely (see
// optimalAssignPicksToSlots below).
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

// Points-based counterpart to assignPicksToSlots above: instead of pinning
// whichever slot a pick was placed in at draft time, this always recomputes
// the best possible slot assignment from scratch by current points - highest
// scorer at each position takes that position's own slot(s) first, then the
// pool of leftover flex-eligible players (by points) fills FLEX, then
// leftover superflex-eligible players fill SUPERFLEX, then whoever's left
// fills bench. Mirrors convex/draft/lineupOptimizer.ts's optimizeLineup
// tiering, just producing a specific slot-key map (which lets it drive the
// same per-slot UI assignPicksToSlots does) instead of only a starter/bench
// split. No manual override exists anymore - this is the only source of
// truth for "who's starting," so it's safe to call fresh on every render.
export function optimalAssignPicksToSlots<
  T extends { position: Position; fpid: number },
>(
  picks: readonly T[],
  rosterSlots: RosterSlotCounts,
  flexPositions: readonly Position[],
  superflexPositions: readonly Position[],
  pointsByFpid: ReadonlyMap<number, number>,
): Map<string, T> {
  const pointsOf = (pick: T) => pointsByFpid.get(pick.fpid) ?? 0;
  const slots = expandRosterSlots(rosterSlots);
  const bySlot = new Map<string, T>();
  const used = new Set<number>();

  const byPosition = new Map<Position, T[]>();
  for (const pick of picks) {
    const list = byPosition.get(pick.position) ?? [];
    list.push(pick);
    byPosition.set(pick.position, list);
  }
  for (const list of byPosition.values()) {
    list.sort((a, b) => pointsOf(b) - pointsOf(a));
  }

  // Fills `targetSlots` in order from `pool` (both already points-sorted),
  // stopping whichever runs out first.
  const fill = (targetSlots: readonly SlotDescriptor[], pool: readonly T[]) => {
    for (let i = 0; i < targetSlots.length; i++) {
      const slot = targetSlots[i];
      const pick = pool[i];
      if (!slot || !pick) break;
      bySlot.set(slot.key, pick);
      used.add(pick.fpid);
    }
  };

  for (const [position, list] of byPosition) {
    fill(
      slots.filter((slot) => slot.position === position),
      list,
    );
  }

  const flexPool = picks
    .filter(
      (pick) => !used.has(pick.fpid) && flexPositions.includes(pick.position),
    )
    .sort((a, b) => pointsOf(b) - pointsOf(a));
  fill(
    slots.filter((slot) => slot.label.startsWith("FLEX")),
    flexPool,
  );

  const superflexPool = picks
    .filter(
      (pick) =>
        !used.has(pick.fpid) && superflexPositions.includes(pick.position),
    )
    .sort((a, b) => pointsOf(b) - pointsOf(a));
  fill(
    slots.filter((slot) => slot.label.startsWith("SFLEX")),
    superflexPool,
  );

  const benchPool = picks
    .filter((pick) => !used.has(pick.fpid))
    .sort((a, b) => pointsOf(b) - pointsOf(a));
  fill(
    slots.filter((slot) => slot.label.startsWith("BN")),
    benchPool,
  );

  return bySlot;
}

// Which of a team's roster slots a player at `position` is allowed to
// occupy - an exact position match, FLEX/SUPERFLEX when eligible, or any
// bench slot. Used by nominationStrategies.ts to work out each opponent's
// remaining fits (e.g. whether they're already full at a position).
// Duplicated (rather than imported) from convex/draft/slots.ts's
// isEligibleForSlot, same as expandRosterSlots above - Convex's bundler
// doesn't allow importing across the convex/ boundary.
export function eligibleSlotsForPosition(
  position: Position,
  slots: readonly SlotDescriptor[],
  flexPositions: readonly Position[],
  superflexPositions: readonly Position[],
): SlotDescriptor[] {
  return slots.filter((slot) => {
    if (slot.position === position) return true;
    if (slot.label.startsWith("FLEX")) return flexPositions.includes(position);
    if (slot.label.startsWith("SFLEX")) {
      return superflexPositions.includes(position);
    }
    if (slot.label.startsWith("BN")) return true;
    return false;
  });
}
