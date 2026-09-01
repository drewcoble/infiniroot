import { createFileRoute } from "@tanstack/react-router";
import type { Id } from "@infinidata/dataModel";
import { FreeAgentsTab } from "../../../pages/Season/FreeAgentsTab";
import { useSelfTeam } from "../../../hooks/useSelfTeam";

export const Route = createFileRoute("/season/$leagueId/freeAgents")({
  component: FreeAgentsRouteLeaf,
});

function FreeAgentsRouteLeaf() {
  const { leagueId } = Route.useParams();
  const seasonId = leagueId as Id<"seasons">;
  const selfTeamResult = useSelfTeam(seasonId);
  if (!selfTeamResult?.selfTeam) return null;

  return (
    <FreeAgentsTab
      seasonId={seasonId}
      selfTeamId={selfTeamResult.selfTeam._id}
    />
  );
}
