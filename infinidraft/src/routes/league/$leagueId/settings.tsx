import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { Stack } from "@mantine/core";
import { api } from "@infinidata/api";
import type { Id } from "@infinidata/dataModel";
import { LeagueDetails } from "../../../pages/Settings/LeagueDetails";
import { setStoredLeagueId } from "../../../lib/leagueStorage";

export const Route = createFileRoute("/league/$leagueId/settings")({
  component: SettingsRoute,
});

// League setup (name, roster/scoring config, teams, salary cap, delete) -
// split out of what used to be the combined "League" tab (see
// league.tsx, which kept the live per-team roster breakdown) so the
// day-to-day draft-room view isn't sharing a tab with one-time/rare setup
// config. LeagueDetails locks itself once the draft starts, same as
// before - this route doesn't need its own started/not-started branching.
function SettingsRoute() {
  const { leagueId } = Route.useParams();
  const navigate = useNavigate();
  const currentUser = useQuery(api.users.getCurrentUser);
  const isNew = leagueId === "new";

  return (
    <Stack gap="lg">
      <LeagueDetails
        selectedLeagueId={isNew ? undefined : (leagueId as Id<"seasons">)}
        isCreatingLeague={isNew}
        onLeagueSaved={(id) => {
          if (currentUser) setStoredLeagueId(currentUser._id, id);
          void navigate({
            to: "/league/$leagueId/settings",
            params: { leagueId: id },
            replace: true,
          });
        }}
        onDoneCreating={() => {}}
        onLeagueDeleted={() => {
          void navigate({
            to: "/league/$leagueId/settings",
            params: { leagueId: "new" },
            replace: true,
          });
        }}
      />
    </Stack>
  );
}
