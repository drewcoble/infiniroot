import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/league/$leagueId/")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/league/$leagueId/settings", params });
  },
});
