import { createFileRoute } from "@tanstack/react-router";
import type { Id } from "@infinidata/dataModel";
import { InjuryReport } from "../../../pages/InjuryReport/InjuryReport";
import { MOBILE_STATS_ROW_HEIGHT, WEEK } from "../../../constants/general";
import { MOBILE_HEADER_HEIGHT } from "@shared/constants";
import { useDraftPhase } from "../../../hooks/useDraftPhase";

export const Route = createFileRoute("/league/$leagueId/injuries")({
  component: InjuriesRoute,
});

function InjuriesRoute() {
  const { leagueId } = Route.useParams();
  const isNew = leagueId === "new";
  const seasonId = isNew ? undefined : (leagueId as Id<"seasons">);
  const phase = useDraftPhase(seasonId);
  return (
    <InjuryReport
      week={WEEK}
      seasonId={seasonId}
      filterBarTop={
        MOBILE_HEADER_HEIGHT + (phase?.isStarted ? MOBILE_STATS_ROW_HEIGHT : 0)
      }
    />
  );
}
