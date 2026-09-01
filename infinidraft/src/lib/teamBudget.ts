import { categoryForSlot } from "./budgetCategories";
import {
  expandRosterSlots,
  type RosterSlotCounts,
  type SlotDescriptor,
} from "./rosterSlots";

export interface TeamBudgetStats {
  remaining: number;
  spent: number;
  openSlots: number;
  totalSlots: number;
  // $1/slot is reserved for every other still-open slot, so this is the most
  // this team could bid on one player without going unable to fill the rest
  // of its roster.
  maxBid: number;
  perOpenSlot: number;
  // The most this team could bid on the current player and still afford the
  // rest of its budget plan for every other unfilled slot - null when there's
  // no plan to reconcile against (always true for opponents, since we never
  // see their plan).
  planSafe: number | null;
}

// Falls back to the league default when a team has no override set (see
// draftTeams.salaryCapOverride in convex/schema.ts).
export function resolveTeamSalaryCap(
  team: { salaryCapOverride?: number } | undefined,
  leagueSalaryCap: number,
): number {
  return team?.salaryCapOverride ?? leagueSalaryCap;
}

export function computeTeamBudgetStats(
  salaryCap: number,
  rosterSlots: RosterSlotCounts,
  picksCount: number,
  spent: number,
  unfilledPlanTotal?: number,
): TeamBudgetStats {
  const totalSlots = expandRosterSlots(rosterSlots).length;
  const openSlots = Math.max(totalSlots - picksCount, 0);
  const remaining = salaryCap - spent;
  const maxBid = openSlots > 0 ? remaining - (openSlots - 1) : remaining;
  const perOpenSlot = openSlots > 0 ? remaining / openSlots : 0;
  const planSafe =
    unfilledPlanTotal !== undefined ? remaining - unfilledPlanTotal : null;
  return {
    remaining,
    spent,
    openSlots,
    totalSlots,
    maxBid,
    perOpenSlot,
    planSafe,
  };
}

// The most aggressive per-starter estimate: reserves just $1 for every
// still-open slot commonly punted for near-nothing (bench, K, DST - a
// common strategy, K/DST included alongside bench for this purpose even
// though budgetCategories.ts keeps them as their own categories), then
// divides whatever's left across the remaining open "real" starter slots
// (QB/RB/WR/TE/FLEX/SFLEX). Null once there are no open starter slots left
// to divide across (a full bench-only roster, or an empty `openSlots`).
export function computeMaxPerStarter(
  remaining: number,
  openSlots: SlotDescriptor[],
): number | null {
  const isPuntSlot = (slot: SlotDescriptor) => {
    const category = categoryForSlot(slot);
    return category === "BENCH" || category === "DST" || category === "K";
  };
  const puntSlotCount = openSlots.filter(isPuntSlot).length;
  const starterSlotCount = openSlots.length - puntSlotCount;
  if (starterSlotCount <= 0) return null;
  return (remaining - puntSlotCount) / starterSlotCount;
}
