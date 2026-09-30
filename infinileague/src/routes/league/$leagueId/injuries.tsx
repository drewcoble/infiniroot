import { createFileRoute } from "@tanstack/react-router";
import type { Id } from "@infinidata/dataModel";
import { InjuryReport } from "@shared/InjuryReport";
import { MOBILE_HEADER_HEIGHT } from "@shared/constants";
import { JevInjuryAssessment } from "../../../components/JevInjuryAssessment";

export const Route = createFileRoute("/league/$leagueId/injuries")({
  component: InjuriesRoute,
});

// Same week infinidraft's Injuries page uses (its WEEK constant) - the
// season-long projections/ADP rows the relevance filter keys off.
const SEASON_WEEK = "0";

function InjuriesRoute() {
  const { leagueId } = Route.useParams();
  return (
    <InjuryReport
      week={SEASON_WEEK}
      seasonId={leagueId as Id<"seasons">}
      filterBarTop={MOBILE_HEADER_HEIGHT}
      renderExpandedExtra={({ injury }) => <JevInjuryAssessment injuryId={injury._id} />}
    />
  );
}
