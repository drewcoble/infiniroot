import { createFileRoute } from "@tanstack/react-router";
import type { Id } from "@infinidata/dataModel";
import { DraftBoard } from "../../pages/DraftBoard/DraftBoard";

// Deliberately NOT nested under draft/$leagueId/route.tsx - this is a bare,
// full-screen page (no AppHeader/Tabs chrome) meant for a second tab/screen,
// not part of the host's own Draft Room navigation.
export const Route = createFileRoute("/board/$leagueId")({
  component: BoardRoute,
});

function BoardRoute() {
  const { leagueId } = Route.useParams();
  return <DraftBoard seasonId={leagueId as Id<"seasons">} />;
}
