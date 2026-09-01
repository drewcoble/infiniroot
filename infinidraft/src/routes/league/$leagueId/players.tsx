import { createFileRoute } from "@tanstack/react-router";
import type { Id } from "@infinidata/dataModel";
import { PlayersTable } from "../../../pages/Settings/PlayersTable";
import { PlayersLeftTab } from "../../../pages/DraftRoom/PlayersLeftTab";
import { WEEK } from "../../../constants/general";
import { useDraftPhase } from "../../../hooks/useDraftPhase";
import { useSelfTeam } from "../../../hooks/useSelfTeam";

export const Route = createFileRoute("/league/$leagueId/players")({
  component: PlayersRoute,
});

// Pre-start (or before teams exist): the general browse/keeper-assignment
// table (PlayersTable, same one the old Setup app used). Once the draft is
// live: the nomination-focused board (PlayersLeftTab) - materially
// different enough (value gaps, nominate actions, needs selfTeamId) that
// switching components rather than adding a mode to one of them matches how
// BudgetTab already does this split.
function PlayersRoute() {
  const { leagueId } = Route.useParams();
  const isNew = leagueId === "new";
  const seasonId = isNew ? undefined : (leagueId as Id<"seasons">);
  const phase = useDraftPhase(seasonId);
  const selfTeamResult = useSelfTeam(seasonId);

  if (phase?.isStarted && selfTeamResult?.selfTeam) {
    return (
      <PlayersLeftTab
        seasonId={seasonId as Id<"seasons">}
        selfTeamId={selfTeamResult.selfTeam._id}
      />
    );
  }

  return (
    <PlayersTable week={WEEK} selectedLeagueId={isNew ? undefined : seasonId} />
  );
}
