import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { Alert, Center, Loader } from "@mantine/core";
import { api } from "@infinidata/api";
import { SetupFlow } from "../../../components/SetupFlow";
import { useMyViewer } from "../../../hooks/useMyViewer";
import { useMySeasons } from "../../../hooks/useMySeasons";
import { useSeasonData } from "../../../lib/seasonData";
import { initialDraft, parseDraft } from "../../../lib/setupFlow";

export const Route = createFileRoute("/league/$leagueId/setup")({
  component: SetupPage,
});

// The commissioner's step-by-step setup (components/SetupFlow.tsx) - for a
// league just put on infiniyoffs, or re-run from Settings. Resumes a saved
// draft; otherwise starts from the rules in place.
function SetupPage() {
  const { leagueId } = Route.useParams();
  const seasonId = leagueId as Id<"seasons">;
  const navigate = useNavigate();
  const viewer = useMyViewer(seasonId);
  const season = useMySeasons()?.find((s) => s._id === leagueId);
  const { data, error, rules, isCustom, format } = useSeasonData();
  const draft = useQuery(
    api.infiniyoffs.setup.getSetupDraft,
    viewer?.isCommissioner ? { seasonId } : "skip",
  );

  if (error) return <Alert color="red">{error}</Alert>;
  if (viewer && !viewer.isCommissioner) {
    return <Alert color="yellow">Only the commissioner can set up the playoffs.</Alert>;
  }
  if (!data || !rules || format === undefined || draft === undefined || !season) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }

  const saved = isCustom ? format : null;
  return (
    <SetupFlow
      seasonId={seasonId}
      data={data}
      rules={rules}
      saved={saved}
      initial={parseDraft(draft) ?? initialDraft(saved)}
      onExit={() =>
        void (season.needsSetup
          ? navigate({ to: "/" })
          : navigate({ to: "/league/$leagueId/settings", params: { leagueId } }))
      }
    />
  );
}
