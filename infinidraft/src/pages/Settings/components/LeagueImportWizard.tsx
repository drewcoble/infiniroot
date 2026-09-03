import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Group,
  Loader,
  Radio,
  Select,
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

interface LeagueImportWizardProps {
  onImported: (id: Id<"seasons">) => void;
  onCancel: () => void;
}

// "Import from Sleeper" branch of the "+ New League" flow (see Part 4 of the
// plan doc, and LeagueCreateChoice.tsx for the fork into this vs. Custom
// Setup). Three steps: find leagues by Sleeper username (same picker pattern
// as the Yahoo connect flow - see SeasonSettingsTab.tsx), pick one to load
// its preview, then review/edit the mapped settings (reusing SettingsForm
// as-is) plus team names/self-selection and an optional prior-season
// keeper-history import, before creating the league.
export function LeagueImportWizard({
  onImported,
  onCancel,
}: LeagueImportWizardProps) {
  const listSleeperLeaguesForUsername = useAction(
    api.sleeper.league.listSleeperLeaguesForUsername,
  );
  const previewSleeperImport = useAction(
    api.sleeper.league.previewSleeperImport,
  );
  const createSettings = useMutation(api.leagues.createLeague);
  const initializeDraftTeams = useMutation(
    api.infinidraft.draft.teams.initializeSeasonTeams,
  );
  const importHistory = useMutation(api.leagues.importPreviousSeasonHistory);

  const [usernameInput, setUsernameInput] = useState("");
  const [sleeperUserId, setSleeperUserId] = useState<string | null>(null);
  const [leagueOptions, setLeagueOptions] = useState<Array<{
    leagueId: string;
    name: string;
    season: string;
  }> | null>(null);
  const [loadingLeagues, setLoadingLeagues] = useState(false);
  const [selectedLeagueId, setSelectedLeagueId] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Awaited<
    ReturnType<typeof previewSleeperImport>
  > | null>(null);

  const [teamNames, setTeamNames] = useState<Record<string, string>>({});
  const [selfOwnerId, setSelfOwnerId] = useState("");
  const [importKeeperHistory, setImportKeeperHistory] = useState(true);
  const [form, setForm] = useState<LeagueSettingsFormValues>(DEFAULT_FORM);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleFindLeagues = async () => {
    setLoadError(null);
    setLoadingLeagues(true);
    try {
      const result = await listSleeperLeaguesForUsername({
        username: usernameInput.trim(),
      });
      setSleeperUserId(result.sleeperUserId);
      setLeagueOptions(result.leagues);
    } catch (err) {
      setLoadError(getErrorMessage(err, "Failed to find leagues."));
    } finally {
      setLoadingLeagues(false);
    }
  };

  const handleSelectLeague = async (leagueId: string | null) => {
    setSelectedLeagueId(leagueId);
    if (!leagueId) return;
    setLoadError(null);
    setLoadingPreview(true);
    try {
      const result = await previewSleeperImport({ sleeperLeagueId: leagueId });
      setPreview(result);
      setTeamNames(
        Object.fromEntries(result.teams.map((t) => [t.rosterId, t.teamName])),
      );
      setSelfOwnerId(
        sleeperUserId && result.teams.some((t) => t.ownerId === sleeperUserId)
          ? sleeperUserId
          : (result.teams[0]?.ownerId ?? ""),
      );
      setForm({
        name: result.name,
        teamCount: result.teamCount,
        // Detected from the linked league's own Sleeper draft (SNAKE_DRAFT.md
        // §6) - falls back to auction if Sleeper has no draft set up yet or
        // the lookup failed (see convex/sleeper/league.ts's
        // fetchSleeperDraftType). Still adjustable on this review step below,
        // gated the same as a from-scratch league (SNAKE_DRAFT_ENABLED).
        draftType: result.draftType ?? DEFAULT_FORM.draftType,
        salaryCap: DEFAULT_FORM.salaryCap,
        scoring: result.scoring,
        // Sleeper's TE-premium/passing-TD settings aren't mapped yet (see
        // convex/sleeper/leagueSettingsMapping.ts) - default off, same as a
        // brand-new custom league, and the owner can adjust after import if
        // their real league differs.
        teScoring: DEFAULT_FORM.teScoring,
        sixPointPassTds: DEFAULT_FORM.sixPointPassTds,
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
    if (!preview || !selectedLeagueId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const newId = await createSettings({
        name: form.name,
        teamCount: form.teamCount,
        // Clamped at the actual write path, not just wherever form.draftType
        // gets set (defense in depth, same as LeagueDetails.tsx's own
        // handleSave) - detected/reviewed above, but still forced back to
        // auction if the flag is off no matter what form.draftType ended
        // up as.
        draftType: SNAKE_DRAFT_ENABLED ? form.draftType : "auction",
        salaryCap: form.salaryCap,
        scoring: form.scoring,
        teScoring: form.teScoring,
        sixPointPassTds: form.sixPointPassTds,
        rosterSlots: form.rosterSlots,
        flexPositions: form.flexPositions,
        superflexPositions: form.superflexPositions,
        sleeperLeagueId: selectedLeagueId,
      });

      const selfTeam = preview.teams.find((t) => t.ownerId === selfOwnerId);
      const opponents = preview.teams.filter((t) => t.ownerId !== selfOwnerId);
      await initializeDraftTeams({
        seasonId: newId,
        selfName: (selfTeam ? teamNames[selfTeam.rosterId] : undefined) ?? "Me",
        opponentNames: opponents.map(
          (t) => teamNames[t.rosterId] ?? t.teamName,
        ),
        ...(selfTeam
          ? {
              selfSleeperLink: {
                sleeperRosterId: selfTeam.rosterId,
                sleeperOwnerId: selfTeam.ownerId,
              },
            }
          : {}),
        opponentSleeperLinks: opponents.map((t) => ({
          sleeperRosterId: t.rosterId,
          sleeperOwnerId: t.ownerId,
        })),
      });

      if (importKeeperHistory && preview.previousSeason) {
        await importHistory({
          newSeasonId: newId,
          season: preview.previousSeason.season,
          sleeperLeagueId: selectedLeagueId,
          ...(selfOwnerId ? { selfOwnerId } : {}),
          ...(preview.previousSeason.draftType !== undefined
            ? { previousDraftType: preview.previousSeason.draftType }
            : {}),
          teams: preview.previousSeason.teams.map((t) => ({
            ownerId: t.ownerId,
            teamName: t.teamName,
            players: t.players.map((p) => ({
              fpid: p.fpid,
              ...(p.price !== undefined ? { price: p.price } : {}),
              ...(p.round !== undefined ? { round: p.round } : {}),
            })),
          })),
        });
      }

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
        <Title order={4}>Import from Sleeper</Title>
        <Group gap="xs" wrap="nowrap">
          <TextInput
            value={usernameInput}
            onChange={(e) => setUsernameInput(e.currentTarget.value)}
            placeholder="Sleeper username"
            style={{ flex: 1 }}
          />
          <Button
            onClick={() => void handleFindLeagues()}
            loading={loadingLeagues}
            disabled={!usernameInput.trim()}
          >
            Find Leagues
          </Button>
        </Group>
        {leagueOptions && (
          <Select
            placeholder="Select a league"
            value={selectedLeagueId}
            data={leagueOptions.map((l) => ({
              value: l.leagueId,
              label: `${l.name} (${l.season})`,
            }))}
            onChange={(value) => void handleSelectLeague(value)}
          />
        )}
        {loadingPreview && <Loader size="sm" />}
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
      <Title order={4}>Import from Sleeper</Title>

      {preview.droppedSlots.length > 0 && (
        <Alert color="yellow">
          These roster slots don't have an equivalent here and were skipped:{" "}
          {preview.droppedSlots.join(", ")}. Your real roster may be larger.
        </Alert>
      )}

      <Card withBorder padding="md">
        <Stack gap="sm">
          <Text fw={500}>Teams</Text>
          <Radio.Group value={selfOwnerId} onChange={setSelfOwnerId}>
            <Stack gap={6}>
              {preview.teams.map((team) => (
                <Group key={team.rosterId} wrap="nowrap" gap="xs">
                  <Radio value={team.ownerId} />
                  <TextInput
                    style={{ flex: 1 }}
                    value={teamNames[team.rosterId] ?? team.teamName}
                    onChange={(e) =>
                      setTeamNames((current) => ({
                        ...current,
                        [team.rosterId]: e.currentTarget.value,
                      }))
                    }
                  />
                </Group>
              ))}
            </Stack>
          </Radio.Group>
        </Stack>
      </Card>

      {preview.previousSeason && (
        <Checkbox
          label={`Also import ${preview.previousSeason.season}'s roster for keeper suggestions${
            preview.previousSeason.draftType === "auction"
              ? ""
              : preview.previousSeason.draftType === "snake" ||
                  preview.previousSeason.draftType === "linear"
                ? " (round-based)"
                : " (no draft data found - eligibility only)"
          }`}
          checked={importKeeperHistory}
          onChange={(e) => setImportKeeperHistory(e.currentTarget.checked)}
        />
      )}

      <SettingsForm
        form={form}
        onChange={setForm}
        error={saveError}
        isSaving={saving}
        onSave={() => void handleCreate()}
        onCancel={onCancel}
        saveLabel="Create League"
        compact
        // Detection above is best-effort - let the host correct it here
        // before creating, same as a from-scratch league (SettingsForm
        // itself still checks SNAKE_DRAFT_ENABLED before actually showing
        // it).
        showDraftType
      />
    </Stack>
  );
}
