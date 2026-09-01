import { createFileRoute } from "@tanstack/react-router";
import { Text } from "@mantine/core";
import { useQuery } from "convex/react";
import { api } from "@infinidata/api";
import type { Id } from "@infinidata/dataModel";
import { DraftTab } from "../../../pages/DraftRoom/DraftTab";
import { SnakeDraftTab } from "../../../pages/DraftRoom/SnakeDraftTab";
import { useSelfTeam } from "../../../hooks/useSelfTeam";

export const Route = createFileRoute("/league/$leagueId/draft")({
  component: DraftRouteLeaf,
});

// Reusable pre-start too - with no picks yet (beyond keepers) it just shows
// an empty recent-picks table and shortlist, which is a reasonable "nothing
// drafted yet" state rather than needing a dedicated placeholder. Nominate
// controls live in DraftTopBar (layout route, started-only) for auction
// only - SnakeDraftTab is self-contained instead (SNAKE_DRAFT.md §5.2).
function DraftRouteLeaf() {
  const { leagueId } = Route.useParams();
  const isNew = leagueId === "new";
  const seasonId = isNew ? undefined : (leagueId as Id<"seasons">);
  const selfTeamResult = useSelfTeam(seasonId);
  const settingsList = useQuery(api.leagues.listSeasons, {});
  const settings = settingsList?.find((s) => s._id === leagueId);

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

  // Absent means "auction" (see convex/draftType.ts's resolveDraftType).
  const draftType = settings?.draftType ?? "auction";

  if (draftType !== "auction") {
    return (
      <SnakeDraftTab
        seasonId={seasonId as Id<"seasons">}
        teams={selfTeamResult.teams}
      />
    );
  }

  return (
    <DraftTab
      seasonId={seasonId as Id<"seasons">}
      teams={selfTeamResult.teams}
    />
  );
}
