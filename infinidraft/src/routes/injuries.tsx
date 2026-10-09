import { createFileRoute } from "@tanstack/react-router";
import { Stack } from "@mantine/core";
import { InjuryReport } from "@shared/InjuryReport";
import { MOBILE_HEADER_HEIGHT } from "@shared/constants";
import { PageContainer } from "@shared/PageContainer";
import { WEEK } from "../constants/general";
import { AppHeader } from "../components/AppHeader";
import { PlayerDetailModal } from "../components/PlayerDetailModal";

export const Route = createFileRoute("/injuries")({
  component: InjuriesRoute,
});

// League-independent - no seasonId, so InjuryReport falls back to PPR and
// every position rather than any one league's scoring/roster slots, and
// PlayerDetailModal skips its league-specific target/avoid tagging.
function InjuriesRoute() {
  return (
    <PageContainer>
      <Stack gap="md">
        <AppHeader hideLeagueControls />
        <InjuryReport
          week={WEEK}
          seasonId={undefined}
          filterBarTop={MOBILE_HEADER_HEIGHT}
          renderPlayerDetail={(props) => (
            <PlayerDetailModal {...props} week={WEEK} seasonId={undefined} />
          )}
        />
      </Stack>
    </PageContainer>
  );
}
