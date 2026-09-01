import { createFileRoute, Outlet } from "@tanstack/react-router";

// Pathless layout for this segment - required by TanStack Router's file-
// based codegen once a nested directory (teams/$teamId.tsx) exists
// alongside index.tsx here. Without this file, the generator produced a
// route tree that referenced a parent route it never actually defined,
// silently dropping the index route out of the tree entirely (confirmed
// live: /league/$leagueId 404'd with the index route missing from
// rootRouteChildren in the generated file). No shared chrome needed here -
// both children (index.tsx, teams/$teamId.tsx) render their own full
// AppHeader/PageContainer independently, so this is just an Outlet.
export const Route = createFileRoute("/league/$leagueId")({
  component: () => <Outlet />,
});
