import { useQuery } from "convex/react";
import { api } from "@infinidata/api";
import type { Id } from "@infinidata/dataModel";
import type { Position } from "../types";
import {
  computeTeamBudgetStats,
  resolveTeamSalaryCap,
  type TeamBudgetStats,
} from "../lib/teamBudget";
import { expandRosterSlots } from "../lib/rosterSlots";
import { assignSlotForPick } from "../lib/slotAssignment";
import { matchPlanSlot } from "../lib/planRecommendation";

// Reused by the Draft Room's top bar, the Draft tab's price rail, and (in a
// later phase) the League tab's per-opponent stats - each just supplies a
// different teamId. PLAN-SAFE only ever resolves for the self team, since
// that's the only budget plan we have.
//
// `targetPosition` is the position of whichever player is currently on the
// block (if any). PLAN-SAFE means two different things depending on whether
// one is supplied:
// - With a targetPosition: the most you could bid on *this* player while
//   still being able to afford your plan for every other still-open slot -
//   this excludes the one slot this player would fill from the "reserve for
//   everything else" sum. Without that exclusion, the reserve would include
//   this pick's own budgeted amount, making PLAN-SAFE collapse to ~$0
//   whenever you're roughly on pace (the reserve would eat its own slot's
//   money before you ever got to spend it).
// - Without one: the overall surplus/deficit vs. plan (remaining minus every
//   still-open slot's budgeted amount) - a "am I on pace" indicator.
//
// `targetDollarValue` (the player's market/VBD value, when known) makes the
// slot-to-reserve-against a value match (via matchPlanSlot) instead of the
// greedy first-open-slot-in-roster-order pick (assignSlotForPick) - a $23
// player should reconcile against a $23-budgeted RB2/FLEX slot, not
// whichever RB slot happens to still be open first.
export function useTeamBudget(
  seasonId: Id<"seasons"> | undefined,
  teamId: Id<"seasonTeams"> | undefined,
  targetPosition?: Position,
  targetDollarValue?: number,
): TeamBudgetStats | undefined {
  const seasonsList = useQuery(api.leagues.listSeasons, {});
  const picks = useQuery(
    api.draft.picks.listDraftPicks,
    seasonId ? { seasonId } : "skip",
  );
  const teams = useQuery(
    api.draft.teams.listSeasonTeams,
    seasonId ? { seasonId } : "skip",
  );
  const plan = useQuery(
    api.draft.plan.getLiveBudgetPlan,
    seasonId ? { seasonId } : "skip",
  );

  const settings = seasonsList?.find((s) => s._id === seasonId);
  if (!settings || !picks || !teams || !teamId) return undefined;

  const team = teams.find((t) => t._id === teamId);
  const teamPicks = picks.filter((pick) => pick.teamId === teamId);
  // Budget tracking is auction-only (SNAKE_DRAFT.md §3.4) - price is
  // always real for the picks this hook runs against.
  const spent = teamPicks.reduce((sum, pick) => sum + (pick.price ?? 0), 0);

  let unfilledPlanTotal: number | undefined;
  if (team?.isSelf && plan) {
    const filledSlotKeys = new Set(
      teamPicks
        .map((pick) => pick.planSlotKey)
        .filter((key): key is string => !!key),
    );
    const openSlots = expandRosterSlots(settings.rosterSlots).filter(
      (slot) => !filledSlotKeys.has(slot.key),
    );
    const targetSlotKey = targetPosition
      ? targetDollarValue !== undefined
        ? matchPlanSlot(
            targetPosition,
            targetDollarValue,
            openSlots,
            plan.amounts,
            settings.flexPositions,
            settings.superflexPositions,
          )?.slotKey
        : assignSlotForPick(
            targetPosition,
            settings.rosterSlots,
            filledSlotKeys,
            settings.flexPositions,
            settings.superflexPositions,
          )
      : undefined;
    unfilledPlanTotal = openSlots
      .filter((slot) => slot.key !== targetSlotKey)
      .reduce((sum, slot) => sum + (plan.amounts[slot.key] ?? 0), 0);
  }

  return computeTeamBudgetStats(
    resolveTeamSalaryCap(team, settings.salaryCap),
    settings.rosterSlots,
    teamPicks.length,
    spent,
    unfilledPlanTotal,
  );
}
