import { useState, type ReactNode } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { Alert, Button, Center, Group, Loader, Stack, Text } from "@mantine/core";
import { api } from "@infinidata/api";
import { sameFormat } from "@playoffRules/carryOver";
import type { PlayoffFormat, PresetConfig } from "@playoffRules/format";
import { presetFormat } from "@playoffRules/presets";
import glass from "@shared/glass/GlassMatchupCard.module.css";
import { FormatPreview } from "../../../components/FormatPreview";
import { GroupsEditor } from "../../../components/GroupsEditor";
import { PlayoffTypeCard, PresetCards } from "../../../components/RulesEditor";
import { LeagueInviteCard } from "../../../components/LeagueInviteCard";
import { useMyViewer } from "../../../hooks/useMyViewer";
import { describeFormat } from "../../../lib/describeFormat";
import { platformFormat } from "../../../lib/platformFormat";
import { savedKind, typeFormat } from "../../../lib/rulesConfig";
import { useSeasonData, type PlayoffRules, type SeasonData } from "../../../lib/seasonData";

export const Route = createFileRoute("/league/$leagueId/settings")({
  component: SettingsPage,
});

// The league's playoff rules in plain words for everyone ("Rules" in the
// tabs for members); the commissioner also gets the playoff type, its
// settings card by card, hand-set groups and matchups for each group
// stage, and the member invites. A bracket preview sits at the bottom.
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
  const summary = (
    <div className={glass.card}>
      <Stack gap={6} p={4}>
        <span className={glass.sectionLabel}>
          {isCustom
            ? "Playoff rules"
            : `Playoff rules · ${data.platformName ? `${data.platformName}'s` : "the platform's"}`}
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
  );

  if (!viewer?.isCommissioner) {
    return (
      <Stack gap="md">
        {summary}
        <FormatPreview format={format} teamCount={data.teams.length} unsaved={false} />
      </Stack>
    );
  }
  return (
    <CommissionerSettings
      seasonId={seasonId}
      data={data}
      rules={rules}
      format={format}
      saved={isCustom ? format : null}
      summary={summary}
    />
  );
}

function CommissionerSettings({
  seasonId,
  data,
  rules,
  format,
  saved,
  summary,
}: {
  seasonId: Id<"seasons">;
  data: SeasonData;
  rules: PlayoffRules;
  // The rules in effect - the saved ones, else the platform's.
  format: PlayoffFormat | null;
  // The commissioner's saved rules - null for the platform's.
  saved: PlayoffFormat | null;
  summary: ReactNode;
}) {
  const current = savedKind(saved);
  // The picked type and the preset's edits, unsaved until their card saves.
  const [kind, setKind] = useState(current);
  const [pending, setPending] = useState<PresetConfig | null>(saved?.preset ?? null);
  // A saved type change starts the settings cards over from it.
  const [syncedKind, setSyncedKind] = useState(current);
  if (syncedKind !== current) {
    setSyncedKind(current);
    setKind(current);
    setPending(saved?.preset ?? null);
  }

  const teamCount = data.teams.length;
  const shown =
    kind !== current
      ? (typeFormat(kind, data, saved) ?? platformFormat(data))
      : pending
        ? presetFormat(pending, teamCount)
        : format;
  const groupStages = saved ? saved.stages.flatMap((s) => (s.kind === "groups" ? [s] : [])) : [];

  return (
    <Stack gap="md">
      {summary}
      <PlayoffTypeCard
        seasonId={seasonId}
        data={data}
        rules={rules}
        saved={saved}
        kind={kind}
        onKindChange={setKind}
      />
      {saved?.preset && pending && pending.kind === saved.preset.kind && (
        <PresetCards
          seasonId={seasonId}
          data={data}
          rules={rules}
          saved={saved.preset}
          pending={pending}
          onPendingChange={setPending}
        />
      )}
      {saved &&
        groupStages.map((stage) => (
          <GroupsEditor
            key={stage.id}
            seasonId={seasonId}
            stage={stage}
            format={saved}
            data={data}
            rules={rules}
          />
        ))}
      <LeagueInviteCard seasonId={seasonId} data={data} />
      <TakeOffCard seasonId={seasonId} />
      <FormatPreview format={shown} teamCount={teamCount} unsaved={!sameFormat(shown, format)} />
    </Stack>
  );
}

// Hides the league from infiniyoffs' home screen and members' lists; its
// rules and groups stay for whenever it's set up again.
function TakeOffCard({ seasonId }: { seasonId: Id<"seasons"> }) {
  const navigate = useNavigate();
  const setInYoffs = useMutation(api.infiniyoffs.leagues.setInYoffs);
  const [saving, setSaving] = useState(false);
  const takeOff = async () => {
    setSaving(true);
    try {
      await setInYoffs({ seasonId, inYoffs: false });
      await navigate({ to: "/" });
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className={glass.card}>
      <Group justify="space-between" wrap="nowrap" p={4}>
        <Text size="sm" c="dimmed">
          Take this league off yoffs. Its rules are kept.
        </Text>
        <Button variant="subtle" color="red" loading={saving} onClick={() => void takeOff()}>
          Take off
        </Button>
      </Group>
    </div>
  );
}
