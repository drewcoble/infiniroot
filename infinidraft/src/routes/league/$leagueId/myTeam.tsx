import { createFileRoute } from "@tanstack/react-router";
import { Text } from "@mantine/core";
import type { Id } from "@infinidata/dataModel";
import { MyTeamTab } from "../../../pages/DraftRoom/MyTeamTab";
import { useSelfTeam } from "../../../hooks/useSelfTeam";

export const Route = createFileRoute("/league/$leagueId/myTeam")({
  component: MyTeamRouteLeaf,
});

function MyTeamRouteLeaf() {
  const { leagueId } = Route.useParams();
  const isNew = leagueId === "new";
  const seasonId = isNew ? undefined : (leagueId as Id<"seasons">);
  const selfTeamResult = useSelfTeam(seasonId);

  if (isNew) {
    return (
      <Text c="dimmed" size="sm">
        Select a league first.
      </Text>
    );
  }
  if (!selfTeamResult) {
    return null;
  }
  if (!selfTeamResult.selfTeam) {
    return (
      <Text c="dimmed" size="sm">
        Add teams on the Settings tab first.
      </Text>
    );
  }

  return (
    <MyTeamTab
      seasonId={seasonId as Id<"seasons">}
      teams={selfTeamResult.teams}
      selfTeamId={selfTeamResult.selfTeam._id}
    />
  );
}
