import type { Id } from "../_generated/dataModel";

// Format-agnostic team rotation math - originally built (and still used) for
// auction's "nomination order in snake mode" (see nominationOrder.ts's
// nextNominator, which is now a thin re-export of stepPickOrder below), but
// the same bounce-at-the-boundary algorithm is exactly what a real snake
// draft's "whose turn is it to pick" needs too (SNAKE_DRAFT.md §3.1) -
// extracted here so both call sites share one implementation instead of
// drifting into two copies of the same math.

// Single, unchecked step - given the configured order/mode and who's
// currently up, computes who's up next with no regard for roster capacity.
// Kept separate from stepPickOrder so the capacity-skipping loop below can
// call it repeatedly without re-deriving the linear/snake math each time.
//
// Linear is a plain round-robin. Snake bounces at each end of the order
// instead of wrapping - when the next step would go out of range, the same
// team is returned again (unchanged) with direction flipped, so that team
// gets two consecutive turns before the order reverses. That's what makes a
// classic snake draft "snake"-shaped: e.g. with 4 teams the sequence is
// A,B,C,D,D,C,B,A,A,B,C,D,... - team D and team A each nominate twice in a
// row at the turns where the direction reverses.
// isReversalBoundary (SNAKE_DRAFT.md §10) says "the round about to be
// entered, if any boundary is actually crossed on this step, is a reversal
// round." Working this out concretely (4 teams A,B,C,D, order index
// 0..3): standard snake is A,B,C,D | D,C,B,A | A,B,C,D | ... - round 2
// ends at index 0 (A), direction -1; the boundary into round 3 repeats A
// and flips direction to +1, giving round 3 = A,B,C,D. 3rd-round reversal
// instead wants round 3 to repeat round 2's order (D,C,B,A) rather than
// alternating back - i.e. pick 9 must be D, not A. That's NOT "flip the
// flip" (repeating A with direction back to -1 would just get stuck
// re-repeating index 0 forever) - it's a different move entirely: jump to
// the *opposite* end of the order from the one just reached, and keep the
// same direction instead of flipping it. Confirmed by hand: end of round 2
// is index 0, direction -1; wrap to index length-1 (D), keep direction -1;
// round 3 proceeds 3,2,1,0 = D,C,B,A. Exactly right, and round 4 then
// resumes the normal bounce from wherever round 3 left off (index 0,
// direction -1 -> repeat + flip to +1), so only the one marked round
// actually behaves differently.
export function rawStep(
  order: readonly Id<"seasonTeams">[],
  mode: "linear" | "snake",
  currentTeamId: Id<"seasonTeams">,
  direction: 1 | -1,
  isReversalBoundary = false,
): { teamId: Id<"seasonTeams">; direction: 1 | -1 } {
  const index = order.indexOf(currentTeamId);
  if (index === -1) {
    // Current team fell out of the order (e.g. order was reconfigured) -
    // simplest safe recovery is to restart at the top.
    return { teamId: order[0]!, direction: 1 };
  }
  if (mode === "linear") {
    return { teamId: order[(index + 1) % order.length]!, direction: 1 };
  }
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= order.length) {
    if (isReversalBoundary) {
      const wrappedIndex = direction === 1 ? 0 : order.length - 1;
      return { teamId: order[wrappedIndex]!, direction };
    }
    return { teamId: order[index]!, direction: direction === 1 ? -1 : 1 };
  }
  return { teamId: order[nextIndex]!, direction };
}

// Given the configured order/mode and who's currently up, computes who's up
// next - skipping any team isTeamFull reports as having no open roster
// slots left, since a team with a full roster (bench included) has nothing
// left to draft/nominate for. Exported so it stays trivially testable/
// reasoned-about in isolation from either call site's DB plumbing.
//
// Repeatedly applies rawStep rather than jumping straight to "the next
// non-full team in list order" so snake's bounce-at-the-boundary behavior
// (see rawStep) is preserved exactly - a full team sitting at the boundary
// just gets its would-be repeat turn skipped, without disturbing anyone
// else's place in the sequence.
export function stepPickOrder(
  order: readonly Id<"seasonTeams">[],
  mode: "linear" | "snake",
  currentTeamId: Id<"seasonTeams">,
  direction: 1 | -1,
  isTeamFull: (teamId: Id<"seasonTeams">) => boolean,
  isReversalBoundary = false,
): { teamId: Id<"seasonTeams"> | null; direction: 1 | -1 } {
  if (order.length === 0) {
    throw new Error("Draft order is empty.");
  }
  let candidate = rawStep(order, mode, currentTeamId, direction, isReversalBoundary);
  // (teamId, direction) is a finite state space of order.length * 2 - if we
  // haven't found an open team within that many steps, every team is full
  // and we're just cycling, so stop and report "nobody left."
  const maxSteps = order.length * 2;
  for (let step = 0; step < maxSteps; step++) {
    if (!isTeamFull(candidate.teamId)) {
      return candidate;
    }
    // Only the very first step above can be a reversal boundary - once
    // we've moved past it (skipping a full team), any further boundary
    // this same call happens to cross uses the plain bounce, since
    // isReversalBoundary describes one specific round transition, not a
    // standing rule.
    candidate = rawStep(order, mode, candidate.teamId, candidate.direction);
  }
  return { teamId: null, direction: candidate.direction };
}

// Which position (1-indexed) `teamId` occupies within `round`'s order,
// computed directly from the static config (base order + reversal rounds)
// rather than replayed pick-by-pick - used to place a round-based keeper
// (SNAKE_DRAFT.md §8) at the correct pickInRound without simulating every
// earlier round. null if teamId isn't in the order at all.
//
// Walks direction round-by-round: round 1 is forward (index i -> position
// i+1); every subsequent round flips forward/backward *unless* it's a
// reversal round, in which case it repeats the previous round's direction
// instead (same rule rawStep's isReversalBoundary encodes, just computed
// statically instead of stepped). Verified by hand against a live-tested
// 4-team draft with reversalRounds [3]: round 1 forward, round 2 backward
// (flip), round 3 backward again (reversal - no flip), round 4 forward
// (flip resumes) - matches the actual turn-by-turn sequence exactly.
//
// Assumes teamId's own slot in this round hasn't itself been traded away
// separately - see pickSlots.ts's file comment on that being an
// unresolved edge case between trades and round-based keepers.
export function resolveTeamPositionInRound(
  order: readonly Id<"seasonTeams">[],
  mode: "linear" | "snake",
  reversalRounds: readonly number[],
  round: number,
  teamId: Id<"seasonTeams">,
): number | null {
  const index = order.indexOf(teamId);
  if (index === -1) return null;
  if (mode === "linear") {
    return index + 1;
  }
  let forward = true;
  for (let r = 2; r <= round; r++) {
    if (!reversalRounds.includes(r)) {
      forward = !forward;
    }
  }
  return forward ? index + 1 : order.length - index;
}
