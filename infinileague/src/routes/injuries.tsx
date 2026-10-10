import { createFileRoute } from "@tanstack/react-router";
import { Stack } from "@mantine/core";
import { InjuryReport } from "@shared/InjuryReport";
import { MOBILE_HEADER_HEIGHT } from "@shared/constants";
import { PageContainer } from "@shared/PageContainer";
import { AppHeader } from "../components/AppHeader";
import { JevInjuryAssessment } from "../components/JevInjuryAssessment";

export const Route = createFileRoute("/injuries")({
  component: InjuriesRoute,
});

// Same week infinidraft's Injuries page uses (its WEEK constant) - the
// season-long projections/ADP rows the relevance filter keys off.
const SEASON_WEEK = "0";

// League-independent - no seasonId, so InjuryReport falls back to PPR and
// every position rather than any one league's scoring/roster slots.
function InjuriesRoute() {
  return (
    <PageContainer>
      <Stack gap="md">
        <AppHeader />
        <InjuryReport
          week={SEASON_WEEK}
          seasonId={undefined}
          filterBarTop={MOBILE_HEADER_HEIGHT}
          renderExpandedExtra={({ injury }) => <JevInjuryAssessment injury={injury} />}
        />
      </Stack>
    </PageContainer>
  );
}
