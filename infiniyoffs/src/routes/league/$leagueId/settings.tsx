import { createFileRoute } from "@tanstack/react-router";
import type { GenericId as Id } from "convex/values";
import { Alert, Center, Loader, Stack, Text } from "@mantine/core";
import glass from "@shared/glass/GlassMatchupCard.module.css";
import { GroupsEditor } from "../../../components/GroupsEditor";
import { RulesEditor } from "../../../components/RulesEditor";
import { TeamInvitesCard } from "../../../components/TeamInvitesCard";
import { useMyViewer } from "../../../hooks/useMyViewer";
import { describeFormat } from "../../../lib/describeFormat";
import { useSeasonData } from "../../../lib/seasonData";

export const Route = createFileRoute("/league/$leagueId/settings")({
  component: SettingsPage,
});

// The league's playoff rules in plain words for everyone ("Rules" in the
// tabs for members); the commissioner also gets the rules form, hand-set
// groups and matchups for each group stage, and the member invites.
function SettingsPage() {
  const { leagueId } = Route.useParams();
  const seasonId = leagueId as Id<"seasons">;
  const viewer = useMyViewer(seasonId);
  const { data, error, rules, format, isCustom } = useSeasonData();

  if (error) return <Alert color="red">{error}</Alert>;
  if (!data || !rules || format === undefined) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }

  const lines = format ? describeFormat(format) : [];
  const groupStages =
    isCustom && format ? format.stages.flatMap((s) => (s.kind === "groups" ? [s] : [])) : [];
  const resets = [
    rules.drafts.length > 0 && "the matchup draft",
    rules.manualGroups.length > 0 && "the hand-set groups",
  ].filter(Boolean);
  return (
    <Stack gap="md">
      <div className={glass.card}>
        <Stack gap={6} p={4}>
          <span className={glass.sectionLabel}>
            {isCustom ? "Playoff rules" : "Playoff rules · the platform's"}
          </span>
          {format === null ? (
            <Text size="sm">This league doesn't have playoffs.</Text>
          ) : (
            lines.map((line) => (
              <Text key={line} size="sm">
                {line}
              </Text>
            ))
          )}
        </Stack>
      </div>
      {viewer?.isCommissioner && (
        <RulesEditor
          // Remounted when the saved rules change, so the form starts from
          // them.
          key={rules.updatedAt ?? 0}
          seasonId={seasonId}
          data={data}
          saved={isCustom ? format : null}
          resets={resets.length > 0 ? resets.join(" and ") : null}
        />
      )}
      {viewer?.isCommissioner &&
        format &&
        groupStages.map((stage) => (
          <GroupsEditor
            key={stage.id}
            seasonId={seasonId}
            stage={stage}
            format={format}
            data={data}
            rules={rules}
          />
        ))}
      {viewer?.isCommissioner && <TeamInvitesCard seasonId={seasonId} />}
    </Stack>
  );
}
