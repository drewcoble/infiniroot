import { createFileRoute } from "@tanstack/react-router";
import { Text } from "@mantine/core";
import type { Id } from "@infinidata/dataModel";
import { BudgetTab } from "../../../components/BudgetTab";
import { useDraftPhase } from "../../../hooks/useDraftPhase";

export const Route = createFileRoute("/league/$leagueId/budget")({
  component: BudgetRoute,
});

// mode is phase-derived, not route-derived, now that pre-draft/live share
// one page - "predraft" edits draftBudgetPlans directly, "live" edits
// draftLiveBudgetOverrides on top of that plan (see BudgetTab.tsx). That
// plan-vs-override split is still worth keeping even on one page: it's what
// lets a commissioner deviate live without losing the original plan to
// compare against or reset back to.
function BudgetRoute() {
  const { leagueId } = Route.useParams();
  const isNew = leagueId === "new";
  const phase = useDraftPhase(isNew ? undefined : (leagueId as Id<"seasons">));
  if (isNew) {
    return (
      <Text c="dimmed" size="sm">
        Select a league first.
      </Text>
    );
  }
  return (
    <BudgetTab
      seasonId={leagueId as Id<"seasons">}
      mode={phase?.isStarted ? "live" : "predraft"}
    />
  );
}
