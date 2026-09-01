import { createFileRoute } from "@tanstack/react-router";
import type { Id } from "@infinidata/dataModel";
import { SeasonSettingsTab } from "../../../pages/Season/SeasonSettingsTab";

export const Route = createFileRoute("/season/$leagueId/settings")({
  component: SeasonSettingsRouteLeaf,
});

function SeasonSettingsRouteLeaf() {
  const { leagueId } = Route.useParams();
  return (
    <SeasonSettingsTab seasonId={leagueId as Id<"seasons">} />
  );
}
