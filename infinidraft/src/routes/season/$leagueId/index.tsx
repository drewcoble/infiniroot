import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/season/$leagueId/")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/season/$leagueId/freeAgents", params });
  },
});
