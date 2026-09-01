import { useQuery } from "convex/react";
import { api } from "@infinidata/api";
import type { Id } from "@infinidata/dataModel";
import type { Position } from "../types";
import { expandRosterSlots, type SlotDescriptor } from "../lib/rosterSlots";

export interface PlanSlots {
  openSlots: SlotDescriptor[];
  amounts: Record<string, number>;
  flexPositions: readonly Position[];
  superflexPositions: readonly Position[];
}

// Raw ingredients for matchPlanSlot (lib/planRecommendation.ts) - split out
// from useTeamBudget so per-row consumers (PlayersLeftTab renders one row
// per remaining player) can call matchPlanSlot in a plain loop instead of a
// hook per row. Only ever resolves for the self team, since only self has a
// saved budget plan to match against.
export function usePlanSlots(
  seasonId: Id<"seasons"> | undefined,
  teamId: Id<"seasonTeams"> | undefined,
): PlanSlots | undefined {
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
  if (!settings || !picks || !teams || !plan || !teamId) return undefined;

  const team = teams.find((t) => t._id === teamId);
  if (!team?.isSelf) return undefined;

  const filledSlotKeys = new Set(
    picks
      .filter((pick) => pick.teamId === teamId)
      .map((pick) => pick.planSlotKey)
      .filter((key): key is string => !!key),
  );
  const openSlots = expandRosterSlots(settings.rosterSlots).filter(
    (slot) => !filledSlotKeys.has(slot.key),
  );

  return {
    openSlots,
    amounts: plan.amounts,
    flexPositions: settings.flexPositions,
    superflexPositions: settings.superflexPositions,
  };
}
