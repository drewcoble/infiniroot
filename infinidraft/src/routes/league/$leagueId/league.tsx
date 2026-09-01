import { createFileRoute } from "@tanstack/react-router";
import { Text } from "@mantine/core";
import type { Id } from "@infinidata/dataModel";
import { LeagueTab as TeamRosterBreakdown } from "../../../pages/DraftRoom/LeagueTab";
import { useSelfTeam } from "../../../hooks/useSelfTeam";

export const Route = createFileRoute("/league/$leagueId/league")({
  component: LeagueRoute,
});

// The live per-team roster breakdown (pages/DraftRoom/LeagueTab.tsx,
// aliased here rather than moved since it's still a perfectly good
// standalone component) - previously combined with league setup on this
// same tab, now split out so day-to-day draft-room use isn't sharing a tab
// with one-time/rare setup config (see settings.tsx). Shown pre-draft too,
// not gated on isStarted - keeper picks and per-team salary cap overrides
// are both set up before the draft starts, so there's often something
// worth seeing here (who's already spoken for, remaining budget) well
// before the first live pick happens.
function LeagueRoute() {
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
    <TeamRosterBreakdown
      seasonId={seasonId as Id<"seasons">}
      teams={selfTeamResult.teams}
      selfTeamId={selfTeamResult.selfTeam._id}
    />
  );
}
