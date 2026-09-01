import { useQuery } from "convex/react";
import { api } from "@infinidata/api";
import type { Doc, Id } from "@infinidata/dataModel";

export interface SelfTeamResult {
  teams: Doc<"seasonTeams">[];
  selfTeam: Doc<"seasonTeams"> | undefined;
}

// Shared by the Draft Room's layout route and every tab's leaf route, all of
// which need both the full team list and which one is "self".
export function useSelfTeam(
  seasonId: Id<"seasons"> | undefined,
): SelfTeamResult | undefined {
  const teams = useQuery(
    api.draft.teams.listSeasonTeams,
    seasonId ? { seasonId } : "skip",
  );
  if (!teams) return undefined;
  return { teams, selfTeam: teams.find((team) => team.isSelf) };
}
