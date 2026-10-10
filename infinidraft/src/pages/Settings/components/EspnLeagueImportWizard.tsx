import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import {
  Alert,
  Button,
  Card,
  Group,
  Radio,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { api } from "@infinidata/api";
import type { Id } from "@infinidata/dataModel";
import {
  DEFAULT_FORM,
  type LeagueSettingsFormValues,
} from "../../../constants/leagueSettings";
import { SettingsForm } from "./SettingsForm";
import { getErrorMessage } from "@shared/errors";
import { SNAKE_DRAFT_ENABLED } from "../../../lib/featureFlags";

interface EspnLeagueImportWizardProps {
  onImported: (id: Id<"seasons">) => void;
  onCancel: () => void;
}

interface EspnImportTeam {
  teamId: string;
  teamName: string;
  ownerName: string | undefined;
}

// ESPN counterpart to LeagueImportWizard.tsx (Sleeper) - same review step
// (SettingsForm + team names/self-selection), but step 1 is a pasted league
// ID/URL instead of a username lookup, since ESPN has none (see
// convex/espn/league.ts's previewEspnImport). Public leagues only for now.
// No prior-season keeper-history import yet, unlike the Sleeper/Yahoo
// wizards.
export function EspnLeagueImportWizard({
  onImported,
  onCancel,
}: EspnLeagueImportWizardProps) {
  const previewEspnImport = useAction(api.espn.league.previewEspnImport);
  const createLeague = useMutation(api.leagues.createLeague);
  const initializeSeasonTeams = useMutation(
    api.infinidraft.draft.teams.initializeSeasonTeams,
  );

  const [leagueInput, setLeagueInput] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Awaited<
    ReturnType<typeof previewEspnImport>
  > | null>(null);

  const [teamNames, setTeamNames] = useState<Record<string, string>>({});
  const [selfTeamId, setSelfTeamId] = useState("");
  const [form, setForm] = useState<LeagueSettingsFormValues>(DEFAULT_FORM);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleFindLeague = async () => {
    setLoadError(null);
    setLoadingPreview(true);
    try {
      const result = await previewEspnImport({ leagueInput });
      const teams: EspnImportTeam[] = result.teams;
      setPreview(result);
      setTeamNames(Object.fromEntries(teams.map((t) => [t.teamId, t.teamName])));
      setSelfTeamId(teams[0]?.teamId ?? "");
      setForm({
        name: result.name,
        teamCount: result.teamCount,
        // Detected from ESPN's draftSettings.type - falls back to auction
        // for a type with no equivalent here, adjustable below.
        draftType: result.draftType ?? DEFAULT_FORM.draftType,
        leagueType: DEFAULT_FORM.leagueType,
        salaryCap: DEFAULT_FORM.salaryCap,
        scoring: result.scoring,
        teScoring: result.teScoring,
        sixPointPassTds: result.sixPointPassTds,
        rosterSlots: result.rosterSlots,
        flexPositions: result.flexPositions,
        superflexPositions: result.superflexPositions,
        useKeepers: DEFAULT_FORM.useKeepers,
      });
    } catch (err) {
      setLoadError(getErrorMessage(err, "Failed to load league."));
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleCreate = async () => {
    if (!preview) return;
    setSaving(true);
    setSaveError(null);
    try {
      const newId = await createLeague({
        name: form.name,
        teamCount: form.teamCount,
        // Clamped at the write path - see LeagueImportWizard.tsx.
        draftType: SNAKE_DRAFT_ENABLED ? form.draftType : "auction",
        leagueType: form.leagueType,
        salaryCap: form.salaryCap,
        scoring: form.scoring,
        teScoring: form.teScoring,
        sixPointPassTds: form.sixPointPassTds,
        rosterSlots: form.rosterSlots,
        flexPositions: form.flexPositions,
        superflexPositions: form.superflexPositions,
        espnLeagueId: preview.espnLeagueId,
      });

      const teams: EspnImportTeam[] = preview.teams;
      const selfTeam = teams.find((t) => t.teamId === selfTeamId);
      const opponents = teams.filter((t) => t.teamId !== selfTeamId);
      await initializeSeasonTeams({
        seasonId: newId,
        selfName: (selfTeam ? teamNames[selfTeam.teamId] : undefined) ?? "Me",
        opponentNames: opponents.map((t) => teamNames[t.teamId] ?? t.teamName),
        ...(selfTeam ? { selfEspnTeamId: selfTeam.teamId } : {}),
        opponentEspnTeamIds: opponents.map((t) => t.teamId),
      });

      onImported(newId);
    } catch (err) {
      setSaveError(getErrorMessage(err, "Failed to import league."));
    } finally {
      setSaving(false);
    }
  };

  if (!preview) {
    return (
      <Stack gap="md" py="sm" maw={500}>
        <Title order={4}>Import from ESPN</Title>
        <Text size="sm" c="dimmed">
          Paste your league's ESPN URL or its league ID. The league must be
          public (League Settings &gt; Basic Settings &gt; "Make League
          Viewable to Public").
        </Text>
        <Group gap="xs" wrap="nowrap">
          <TextInput
            value={leagueInput}
            onChange={(e) => setLeagueInput(e.currentTarget.value)}
            placeholder="League URL or ID"
            style={{ flex: 1 }}
          />
          <Button
            onClick={() => void handleFindLeague()}
            loading={loadingPreview}
            disabled={!leagueInput.trim()}
          >
            Find League
          </Button>
        </Group>
        {loadError && <Alert color="red">{loadError}</Alert>}
        <Group>
          <Button variant="subtle" onClick={onCancel}>
            Back
          </Button>
        </Group>
      </Stack>
    );
  }

  return (
    <Stack gap="lg" py="sm" maw={560}>
      <Title order={4}>Import from ESPN</Title>

      {preview.droppedSlots.length > 0 && (
        <Alert color="yellow">
          These roster slots don't have an equivalent here and were skipped:{" "}
          {preview.droppedSlots.join(", ")}. Your real roster may be larger.
        </Alert>
      )}

      <Card padding="md">
        <Stack gap="sm">
          <Text fw={500}>Teams</Text>
          <Radio.Group value={selfTeamId} onChange={setSelfTeamId}>
            <Stack gap={6}>
              {preview.teams.map((team: EspnImportTeam) => (
                <Group key={team.teamId} wrap="nowrap" gap="xs">
                  <Radio value={team.teamId} />
                  <TextInput
                    style={{ flex: 1 }}
                    value={teamNames[team.teamId] ?? team.teamName}
                    description={team.ownerName}
                    onChange={(e) =>
                      setTeamNames((current) => ({
                        ...current,
                        [team.teamId]: e.currentTarget.value,
                      }))
                    }
                  />
                </Group>
              ))}
            </Stack>
          </Radio.Group>
        </Stack>
      </Card>

      <SettingsForm
        form={form}
        onChange={setForm}
        error={saveError}
        isSaving={saving}
        onSave={() => void handleCreate()}
        onCancel={onCancel}
        saveLabel="Create League"
        compact
        showDraftType
      />
    </Stack>
  );
}
