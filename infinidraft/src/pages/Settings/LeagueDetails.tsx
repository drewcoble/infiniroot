import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Link } from "@tanstack/react-router";
import { Play, Trophy, Undo2 } from "lucide-react";
import {
  Anchor,
  Badge,
  Button,
  Card,
  Center,
  Group,
  List,
  Loader,
  Modal,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { api } from "@infinidata/api";
import type { Id } from "@infinidata/dataModel";
import type { DraftTypeFormat } from "../../types";
import { positionColorOrDefault } from "@shared/positionColors";
import { SNAKE_DRAFT_ENABLED } from "../../lib/featureFlags";
import {
  DEFAULT_FORM,
  DRAFT_TYPE_OPTIONS,
  ROSTER_SLOT_KEYS,
  SCORING_OPTIONS,
  TE_SCORING_OPTIONS,
  type LeagueSettingsFormValues,
} from "../../constants/leagueSettings";
import { SettingsForm } from "./components/SettingsForm";
import { SeasonHistoryPanel } from "./components/SeasonHistoryPanel";
import { TeamsPanel } from "./components/TeamsPanel";
import { PickSlotsPanel } from "./components/PickSlotsPanel";
import { LeagueCreateChoice } from "./components/LeagueCreateChoice";
import { LeagueImportWizard } from "./components/LeagueImportWizard";
import { YahooLeagueImportWizard } from "./components/YahooLeagueImportWizard";
import { UpgradePrompt } from "../../components/UpgradePrompt";
import { LockedNotice } from "../../components/LockedNotice";
import { useDraftPhase } from "../../hooks/useDraftPhase";
import { useSleeperDraftScheduleRefresh } from "../../hooks/useSleeperDraftScheduleRefresh";
import { getErrorMessage } from "@shared/errors";
import { formatSleeperDraftSchedule } from "../../lib/sleeperDraftSchedule";

interface LeagueDetailsProps {
  selectedLeagueId: Id<"seasons"> | undefined;
  isCreatingLeague: boolean;
  onLeagueSaved: (id: Id<"seasons">) => void;
  onDoneCreating: () => void;
  onLeagueDeleted: () => void;
}

export function LeagueDetails({
  selectedLeagueId,
  isCreatingLeague,
  onLeagueSaved,
  onDoneCreating,
  onLeagueDeleted,
}: LeagueDetailsProps) {
  const settingsList = useQuery(api.leagues.listSeasons, {});
  const entitlement = useQuery(api.infinidraft.billing.queries.getMyEntitlement);
  const createSettings = useMutation(api.leagues.createLeague);
  const updateSettings = useMutation(api.leagues.updateSeason);
  const draftTeams = useQuery(
    api.infinidraft.draft.teams.listSeasonTeams,
    selectedLeagueId ? { seasonId: selectedLeagueId } : "skip",
  );
  const initializeDraftTeams = useMutation(
    api.infinidraft.draft.teams.initializeSeasonTeams,
  );
  const renameDraftTeam = useMutation(api.infinidraft.draft.teams.renameSeasonTeam);
  const setTeamSalaryCap = useMutation(api.infinidraft.draft.teams.setTeamSalaryCap);
  const addDraftTeam = useMutation(api.infinidraft.draft.teams.addSeasonTeam);
  const removeDraftTeam = useMutation(api.infinidraft.draft.teams.removeSeasonTeam);
  const setUseKeepers = useMutation(api.leagues.setUseKeepers);
  const setDraftType = useMutation(api.leagues.setDraftType);
  const deleteDraftSettings = useMutation(api.leagues.deleteLeague);
  const phase = useDraftPhase(selectedLeagueId);
  const isStarted = phase?.isStarted ?? false;
  const startDraft = useMutation(api.infinidraft.draft.lifecycle.startDraft);
  const reopenPreDraft = useMutation(api.infinidraft.draft.lifecycle.reopenPreDraft);
  const linkSleeperDraft = useAction(api.sleeper.draftSync.linkSleeperDraft);
  const disableLiveSync = useMutation(api.sleeper.draftSync.disableLiveSync);
  const seasonLineage = useQuery(
    api.infinidraft.draft.history.listSeasonLineage,
    selectedLeagueId ? { seasonId: selectedLeagueId } : "skip",
  );
  const nominationConfig = useQuery(
    api.infinidraft.draft.nominationOrder.getNominationConfig,
    selectedLeagueId ? { seasonId: selectedLeagueId } : "skip",
  );
  const draftOrderConfig = useQuery(
    api.infinidraft.draft.draftOrder.getDraftOrderConfig,
    selectedLeagueId ? { seasonId: selectedLeagueId } : "skip",
  );

  const [isEditing, setIsEditing] = useState(false);
  // Gates the "+ New League" flow's first screen (Custom Setup vs. Import
  // from Sleeper/Yahoo - see LeagueCreateChoice.tsx) ahead of isEditing/
  // SettingsForm taking over for the custom path. null once a choice has
  // been made or there's no creation in progress.
  const [createMode, setCreateMode] = useState<
    "choice" | "sleeperImport" | "yahooImport" | null
  >(null);
  const [form, setForm] = useState<LeagueSettingsFormValues>(DEFAULT_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selfName, setSelfName] = useState("Team 1");
  const [opponentNames, setOpponentNames] = useState<string[]>([]);
  const [isSavingTeams, setIsSavingTeams] = useState(false);
  const [teamsError, setTeamsError] = useState<string | null>(null);

  const [historySeasonId, setHistorySeasonId] = useState<Id<"seasons"> | null>(
    null,
  );
  const [useKeepersError, setUseKeepersError] = useState<string | null>(null);
  const [draftTypeError, setDraftTypeError] = useState<string | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [startModalOpen, setStartModalOpen] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [isReopening, setIsReopening] = useState(false);
  const [reopenError, setReopenError] = useState<string | null>(null);
  const [liveSyncError, setLiveSyncError] = useState<string | null>(null);
  const [liveSyncStatus, setLiveSyncStatus] = useState<string | null>(null);
  const [linkingLiveSync, setLinkingLiveSync] = useState(false);

  // Triggered by the "+ New League" option in the header dropdown, which can
  // fire regardless of which tab is currently active.
  useEffect(() => {
    if (isCreatingLeague) {
      setError(null);
      setIsEditing(false);
      setCreateMode("choice");
    }
  }, [isCreatingLeague]);

  const settings = settingsList?.find(
    (league) => league._id === selectedLeagueId,
  );
  const syncStatus = useQuery(
    api.sleeper.draftSync.getSyncStatus,
    settings?.sleeperLeagueId && selectedLeagueId
      ? { seasonId: selectedLeagueId }
      : "skip",
  );
  useSleeperDraftScheduleRefresh(
    settings?._id,
    settings?.sleeperLeagueId,
    settings?.draftStatus === "pre_draft",
  );

  // Size the opponent-name inputs to this league's team count once it's
  // known - only relevant while no teams have been set up yet.
  useEffect(() => {
    if (!settings || draftTeams === undefined || draftTeams.length > 0) {
      return;
    }
    const opponentCount = Math.max(settings.teamCount - 1, 0);
    setOpponentNames((current) =>
      current.length === opponentCount
        ? current
        : Array.from({ length: opponentCount }, (_, index) => `Team ${index + 2}`),
    );
  }, [settings, draftTeams]);

  if (settingsList === undefined) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }

  const startEditing = () => {
    setForm(
      settings
        ? {
            name: settings.name,
            teamCount: settings.teamCount,
            // Absent means "auction" (see convex/draftType.ts's
            // resolveDraftType) - display-only here regardless, since this
            // field isn't part of handleSave's updateSeason payload at all.
            // An existing league's draftType changes via the live
            // draftTypeControl below (setDraftType) instead, not this
            // form's own batched Save.
            draftType: settings.draftType ?? "auction",
            salaryCap: settings.salaryCap,
            scoring: settings.scoring,
            teScoring: settings.teScoring ?? "NONE",
            sixPointPassTds: settings.sixPointPassTds ?? false,
            rosterSlots: { ...settings.rosterSlots },
            flexPositions: [...settings.flexPositions],
            superflexPositions: [...settings.superflexPositions],
            // Not actually used once editing (the live useKeepersControl
            // below drives it instead) - kept in sync anyway so form always
            // reflects settings.useKeepers if anything ever reads it.
            useKeepers: settings.useKeepers ?? true,
          }
        : DEFAULT_FORM,
    );
    setError(null);
    setIsEditing(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const payload = {
        name: form.name,
        teamCount: form.teamCount,
        salaryCap: form.salaryCap,
        scoring: form.scoring,
        teScoring: form.teScoring,
        sixPointPassTds: form.sixPointPassTds,
        rosterSlots: form.rosterSlots,
        flexPositions: form.flexPositions,
        superflexPositions: form.superflexPositions,
      };
      if (isCreatingLeague || !settings) {
        const newId = await createSettings({
          ...payload,
          // Clamped here too, not just at the SettingsForm control that
          // sets form.draftType - defense in depth so this can't create a
          // non-auction league while the flag is off no matter how
          // form.draftType ended up set (SettingsForm.tsx's own
          // showDraftType && SNAKE_DRAFT_ENABLED check is the only thing
          // stopping a *manual* pick, but this is the actual write path).
          draftType: SNAKE_DRAFT_ENABLED ? form.draftType : "auction",
          useKeepers: form.useKeepers,
        });
        onLeagueSaved(newId);
      } else {
        await updateSettings({ id: settings._id, ...payload });
        onLeagueSaved(settings._id);
      }
      onDoneCreating();
      setIsEditing(false);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to save settings."));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveTeams = async () => {
    if (!settings) return;
    setIsSavingTeams(true);
    setTeamsError(null);
    try {
      await initializeDraftTeams({
        seasonId: settings._id,
        selfName,
        opponentNames,
      });
    } catch (err) {
      setTeamsError(getErrorMessage(err, "Failed to save teams."));
    } finally {
      setIsSavingTeams(false);
    }
  };

  const handleRenameTeam = async (teamId: Id<"seasonTeams">, name: string) => {
    setTeamsError(null);
    try {
      await renameDraftTeam({ teamId, name });
    } catch (err) {
      setTeamsError(getErrorMessage(err, "Failed to rename team."));
    }
  };

  const handleSetTeamSalaryCap = async (
    teamId: Id<"seasonTeams">,
    salaryCap: number | null,
  ) => {
    setTeamsError(null);
    try {
      await setTeamSalaryCap({ teamId, salaryCap });
    } catch (err) {
      setTeamsError(getErrorMessage(err, "Failed to set salary cap."));
    }
  };

  const handleRemoveTeam = async (teamId: Id<"seasonTeams">) => {
    setTeamsError(null);
    try {
      await removeDraftTeam({ teamId });
    } catch (err) {
      setTeamsError(getErrorMessage(err, "Failed to remove team."));
    }
  };

  const handleAddTeam = async (name: string) => {
    if (!settings) return;
    setTeamsError(null);
    try {
      await addDraftTeam({ seasonId: settings._id, name });
    } catch (err) {
      setTeamsError(getErrorMessage(err, "Failed to add team."));
    }
  };

  const handleToggleUseKeepers = async (checked: boolean) => {
    if (!settings) return;
    setUseKeepersError(null);
    try {
      await setUseKeepers({ id: settings._id, useKeepers: checked });
    } catch (err) {
      setUseKeepersError(
        getErrorMessage(err, "Failed to update keepers setting."),
      );
    }
  };

  const handleSetDraftType = async (draftType: DraftTypeFormat) => {
    if (!settings) return;
    setDraftTypeError(null);
    try {
      await setDraftType({ id: settings._id, draftType });
    } catch (err) {
      setDraftTypeError(getErrorMessage(err, "Failed to update draft type."));
    }
  };

  const handleStartDraft = async () => {
    if (!settings) return;
    setIsStarting(true);
    setStartError(null);
    try {
      await startDraft({ seasonId: settings._id });
      setStartModalOpen(false);
    } catch (err) {
      setStartError(getErrorMessage(err, "Failed to start the draft."));
    } finally {
      setIsStarting(false);
    }
  };

  const handleReopenPreDraft = async () => {
    if (!settings) return;
    setIsReopening(true);
    setReopenError(null);
    try {
      await reopenPreDraft({ seasonId: settings._id });
    } catch (err) {
      setReopenError(getErrorMessage(err, "Failed to reopen pre-draft."));
    } finally {
      setIsReopening(false);
    }
  };

  const handleEnableLiveSync = async () => {
    if (!settings) return;
    setLiveSyncError(null);
    setLiveSyncStatus(null);
    setLinkingLiveSync(true);
    try {
      await linkSleeperDraft({ seasonId: settings._id });
      setLiveSyncStatus(
        "Live sync enabled - watching for the Sleeper draft to start.",
      );
    } catch (err) {
      setLiveSyncError(getErrorMessage(err, "Failed to enable live sync."));
    } finally {
      setLinkingLiveSync(false);
    }
  };

  const handleDisableLiveSync = async () => {
    if (!settings) return;
    setLiveSyncError(null);
    setLiveSyncStatus(null);
    try {
      await disableLiveSync({ seasonId: settings._id });
      setLiveSyncStatus("Live sync disabled.");
    } catch (err) {
      setLiveSyncError(getErrorMessage(err, "Failed to disable live sync."));
    }
  };

  const handleDelete = async () => {
    if (!settings) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteDraftSettings({ id: settings._id });
      setDeleteModalOpen(false);
      onLeagueDeleted();
    } catch (err) {
      setDeleteError(getErrorMessage(err, "Failed to delete league."));
    } finally {
      setIsDeleting(false);
    }
  };

  if (
    createMode === "choice" &&
    entitlement &&
    !entitlement.hasProAccess &&
    !entitlement.canCreateFreeLeague
  ) {
    return (
      <UpgradePrompt
        title={`Free plan is limited to ${entitlement.freeLeagueLimit} leagues per year`}
      />
    );
  }

  if (createMode === "choice") {
    return (
      <LeagueCreateChoice
        onChooseCustom={() => {
          setCreateMode(null);
          setForm(DEFAULT_FORM);
          setError(null);
          setIsEditing(true);
        }}
        onChooseSleeperImport={() => setCreateMode("sleeperImport")}
        onChooseYahooImport={() => setCreateMode("yahooImport")}
      />
    );
  }

  if (createMode === "sleeperImport") {
    return (
      <LeagueImportWizard
        onImported={(id) => {
          setCreateMode(null);
          onLeagueSaved(id);
          onDoneCreating();
        }}
        onCancel={() => {
          setCreateMode(null);
          onDoneCreating();
        }}
      />
    );
  }

  if (createMode === "yahooImport") {
    return (
      <YahooLeagueImportWizard
        onImported={(id) => {
          setCreateMode(null);
          onLeagueSaved(id);
          onDoneCreating();
        }}
        onCancel={() => {
          setCreateMode(null);
          onDoneCreating();
        }}
      />
    );
  }

  if (isEditing) {
    return (
      <SettingsForm
        form={form}
        onChange={setForm}
        error={error}
        isSaving={isSaving}
        onSave={handleSave}
        onCancel={() => {
          setIsEditing(false);
          onDoneCreating();
        }}
        teamsLocked={!!draftTeams && draftTeams.length > 0}
        // Shown for a brand-new league (draftTypeControl left undefined,
        // rides along with the rest of the form on Save) or an existing
        // pre-draft one (draftTypeControl below, live setDraftType) - once
        // the draft has started, draftType is permanently locked in.
        showDraftType={!settings || !isStarted}
        configLocked={isStarted}
        {...(settings && !isStarted
          ? {
              draftTypeControl: {
                checked: settings.draftType ?? "auction",
                onChange: (draftType: DraftTypeFormat) =>
                  void handleSetDraftType(draftType),
                error: draftTypeError,
              },
            }
          : {})}
        useKeepersControl={
          settings
            ? {
                // Existing league - live-toggles via setUseKeepers,
                // independent of this form's own Save/Cancel.
                checked: settings.useKeepers ?? true,
                onChange: handleToggleUseKeepers,
                error: useKeepersError,
                disabled: !entitlement?.hasProAccess || isStarted,
                ...(isStarted
                  ? {
                      lockedMessage:
                        "This draft has started - reopen pre-draft to change it.",
                    }
                  : {}),
              }
            : {
                // Brand-new league - no id yet to toggle a live mutation
                // against, so this just sets local form state and rides
                // along with the rest of the form on Save (see handleSave).
                checked: form.useKeepers,
                onChange: (checked) => setForm({ ...form, useKeepers: checked }),
                error: null,
                disabled: !entitlement?.hasProAccess,
              }
        }
      />
    );
  }

  if (!settings) {
    return (
      <Stack gap="md" py="sm">
        <Text c="dimmed">No league settings configured yet.</Text>
        <Button onClick={startEditing} w="fit-content">
          Create League Settings
        </Button>
      </Stack>
    );
  }

  const rosterEntries = ROSTER_SLOT_KEYS.map(
    (slot) => [slot, settings.rosterSlots[slot]] as const,
  );
  // Total draft rounds for a snake/linear league (one round per roster
  // slot, SNAKE_DRAFT.md §10) - bounds TeamsPanel's reversal-rounds picker
  // to rounds that will actually exist in this league's draft.
  const totalRounds = ROSTER_SLOT_KEYS.reduce(
    (sum, slot) => sum + settings.rosterSlots[slot],
    0,
  );

  const hasTeams = !!draftTeams && draftTeams.length > 0;

  return (
    <Stack gap="lg" py="sm">
      <Group justify="space-between" align="center">
        <Title order={4}>{settings.name}</Title>
        <Group gap="xs">
          {!isStarted && (
            <Tooltip
              label="Add at least one team before starting the draft"
              disabled={hasTeams}
            >
              <Button
                leftSection={<Play size={16} />}
                onClick={() => setStartModalOpen(true)}
                disabled={!hasTeams}
              >
                Start Draft
              </Button>
            </Tooltip>
          )}
          {isStarted && (
            <Button
              variant="default"
              leftSection={<Undo2 size={16} />}
              onClick={handleReopenPreDraft}
              loading={isReopening}
            >
              Reopen Pre-Draft
            </Button>
          )}
          <Button
            color="red"
            variant="outline"
            onClick={() => setDeleteModalOpen(true)}
          >
            Delete League
          </Button>
        </Group>
      </Group>
      {reopenError && (
        <Text c="red" size="sm">
          {reopenError}
        </Text>
      )}
      {isStarted && (
        <LockedNotice>
          Scoring, roster, keeper rules, and teams are locked.
        </LockedNotice>
      )}

      <Modal
        opened={startModalOpen}
        onClose={() => setStartModalOpen(false)}
        title="Start the draft"
      >
        <Stack gap="md">
          <Text size="sm">
            This locks scoring, roster slots, and keeper rules. You can reopen
            pre-draft until the first player is drafted.
          </Text>
          {startError && (
            <Text c="red" size="sm">
              {startError}
            </Text>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setStartModalOpen(false)}>
              Cancel
            </Button>
            <Button loading={isStarting} onClick={handleStartDraft}>
              Start Draft
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* No outer Card - SeasonHistoryPanel renders SeasonSummary's own
          grid of per-team Cards when a past season is selected, so wrapping
          this section would nest a Card inside a Card. */}
      {seasonLineage !== undefined && seasonLineage.length > 1 && (
        <SeasonHistoryPanel
          seasonLineage={seasonLineage}
          currentSettingsId={settings._id}
          historySeasonId={historySeasonId}
          onSelectHistorySeason={setHistorySeasonId}
        />
      )}

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <Card withBorder padding="md">
          <Stack gap="md">
            <Group justify="space-between" align="center">
              <Text size="md" fw={500}>
                League Settings
              </Text>
              <Button variant="default" size="md" onClick={startEditing}>
                Edit
              </Button>
            </Group>
            {/* Plain stat blocks, not Cards - this whole panel is already
                inside the "League Settings" Card above, and nesting Cards
                inside a Card reads as boxes-in-boxes. */}
            <SimpleGrid cols={3} spacing="md">
              <Stack gap={0}>
                <Text size="sm" c="dimmed">
                  Teams
                </Text>
                <Text size="xl" fw={700}>
                  {settings.teamCount}
                </Text>
              </Stack>
              <Stack gap={0}>
                <Text size="sm" c="dimmed">
                  Draft Type
                </Text>
                <Text size="xl" fw={700}>
                  {DRAFT_TYPE_OPTIONS.find(
                    (option) => option.value === (settings.draftType ?? "auction"),
                  )?.label ?? "Auction"}
                </Text>
              </Stack>
              {/* Not applicable outside auction - see SNAKE_DRAFT.md §2.1. */}
              {(settings.draftType ?? "auction") === "auction" && (
                <Stack gap={0}>
                  <Text size="sm" c="dimmed">
                    Salary Cap
                  </Text>
                  <Text size="xl" fw={700}>
                    ${settings.salaryCap}
                  </Text>
                </Stack>
              )}
              <Stack gap={0}>
                <Text size="sm" c="dimmed">
                  Scoring
                </Text>
                <Text size="xl" fw={700}>
                  {SCORING_OPTIONS.find(
                    (option) => option.value === settings.scoring,
                  )?.label ?? settings.scoring}
                </Text>
              </Stack>
            </SimpleGrid>
            <Group gap="lg">
              <Text size="sm" c="dimmed">
                TE Premium:{" "}
                {TE_SCORING_OPTIONS.find(
                  (option) => option.value === (settings.teScoring ?? "NONE"),
                )?.label ?? "No Bonus"}
              </Text>
              <Text size="sm" c="dimmed">
                Passing TDs: {settings.sixPointPassTds ? "6 pts" : "4 pts"}
              </Text>
            </Group>
            <Stack gap={6}>
              <Text size="sm" c="dimmed">
                Roster Slots
              </Text>
              <Group gap="xs">
                {rosterEntries
                  .filter(([, count]) => count > 0)
                  .map(([slot, count]) => (
                    <Badge
                      key={slot}
                      variant="light"
                      size="lg"
                      color={positionColorOrDefault(slot)}
                    >
                      {slot}: {count}
                    </Badge>
                  ))}
              </Group>
            </Stack>
            <Group gap="lg">
              <Text size="sm" c="dimmed">
                FLEX eligible: {settings.flexPositions.join(", ")}
              </Text>
              <Text size="sm" c="dimmed">
                SUPERFLEX eligible: {settings.superflexPositions.join(", ")}
              </Text>
              {entitlement && !entitlement.hasProAccess ? (
                <Group gap={4} wrap="nowrap">
                  <Text size="sm" c="dimmed">
                    Use Keepers:
                  </Text>
                  <Trophy size={14} />
                  <Text size="sm" c="dimmed">
                    Pro only
                  </Text>
                </Group>
              ) : (
                <Text size="sm" c="dimmed">
                  Use Keepers: {(settings.useKeepers ?? true) ? "Yes" : "No"}
                </Text>
              )}
            </Group>
          </Stack>
        </Card>

        <Card withBorder padding="md">
          {draftTeams === undefined ? (
            <Stack gap={6}>
              <Text size="md" fw={500}>
                Teams
              </Text>
              <Loader size="sm" />
            </Stack>
          ) : draftTeams.length === 0 ? (
            <Stack gap="sm" maw={420}>
              <Text size="md" fw={500}>
                Teams
              </Text>
              <TextInput
                label="Your team name"
                value={selfName}
                onChange={(event) => setSelfName(event.currentTarget.value)}
              />
              {opponentNames.map((name, index) => (
                <TextInput
                  key={index}
                  placeholder={`Team ${index + 2}`}
                  value={name}
                  onChange={(event) => {
                    const next = [...opponentNames];
                    next[index] = event.currentTarget.value;
                    setOpponentNames(next);
                  }}
                />
              ))}
              {teamsError && (
                <Text c="red" size="sm">
                  {teamsError}
                </Text>
              )}
              <Button
                onClick={handleSaveTeams}
                loading={isSavingTeams}
                disabled={
                  !selfName.trim() || opponentNames.some((name) => !name.trim())
                }
                w="fit-content"
              >
                Save Teams
              </Button>
            </Stack>
          ) : (
            <TeamsPanel
              seasonId={settings._id}
              teams={draftTeams}
              nominationOrder={nominationConfig?.nominationOrder}
              nominationOrderMode={nominationConfig?.nominationOrderMode}
              salaryCap={settings.salaryCap}
              onRenameTeam={handleRenameTeam}
              onSetTeamSalaryCap={handleSetTeamSalaryCap}
              onAddTeam={handleAddTeam}
              onRemoveTeam={handleRemoveTeam}
              renameError={teamsError}
              addLocked={isStarted}
              removeLocked={isStarted}
              isSnakeOrLinear={(settings.draftType ?? "auction") !== "auction"}
              draftOrder={draftOrderConfig?.draftOrder}
              reversalRounds={draftOrderConfig?.reversalRounds}
              maxRounds={totalRounds}
            />
          )}
        </Card>
      </SimpleGrid>

      {(settings.draftType ?? "auction") !== "auction" && hasTeams && (
        <PickSlotsPanel
          seasonId={settings._id}
          teams={draftTeams ?? []}
          maxRounds={totalRounds}
          isDraftStarted={isStarted}
        />
      )}

      {settings.sleeperLeagueId && (
        <Card withBorder padding="md">
          <Stack gap="sm">
            <Group justify="space-between">
              <Text fw={500}>Live sync from Sleeper</Text>
              {settings.sleeperSyncEnabled && (
                <Badge variant="light" color={syncStatus?.syncError ? "yellow" : "teal"}>
                  {syncStatus?.syncError ? "Sync issue" : "Live"}
                </Badge>
              )}
            </Group>
            {!isStarted && settings.sleeperDraftScheduledAt !== undefined && (
              <Text size="sm">
                Scheduled for{" "}
                <Text component="span" fw={600}>
                  {formatSleeperDraftSchedule(settings.sleeperDraftScheduledAt)}
                </Text>
              </Text>
            )}
            <Text size="sm" c="dimmed">
              Mirror picks from your league's actual Sleeper draft into this
              board as they happen - no webhooks exist on Sleeper's side, so
              this polls in the background. Requires every team to be mapped
              to a Sleeper roster (Season Settings, after import), and the
              Sleeper draft's format (auction/snake/linear) to match this
              league's configured draft type above. For a snake or linear
              draft, also set the Draft Order below to match Sleeper's real
              draft order first.
            </Text>
            {settings.sleeperSyncEnabled ? (
              <>
                <Text size="sm">
                  {syncStatus?.lastSyncedAt
                    ? `Last checked ${new Date(syncStatus.lastSyncedAt).toLocaleTimeString()}`
                    : "Starting up..."}
                </Text>
                <Button
                  variant="default"
                  color="red"
                  onClick={() => void handleDisableLiveSync()}
                  w="fit-content"
                >
                  Disable Live Sync
                </Button>
              </>
            ) : (
              <Button
                onClick={() => void handleEnableLiveSync()}
                loading={linkingLiveSync}
                disabled={!draftTeams?.length || draftTeams.some((t) => !t.sleeperRosterId)}
                w="fit-content"
              >
                Enable Live Sync from Sleeper
              </Button>
            )}
            {liveSyncStatus && (
              <Text size="xs" c="teal">
                {liveSyncStatus}
              </Text>
            )}
            {(syncStatus?.syncError || liveSyncError) && (
              <Text size="xs" c={liveSyncError ? "red" : "yellow.7"}>
                {liveSyncError ?? syncStatus?.syncError}
              </Text>
            )}
          </Stack>
        </Card>
      )}

      <Modal
        opened={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Delete league"
      >
        <Stack gap="md">
          <Text size="sm">
            This will delete all seasons for this league. This cannot be undone.
          </Text>
          <List size="sm">
            {(seasonLineage ?? [settings]).map((season) => (
              <List.Item key={season._id}>
                {settings.name} ({season.year})
              </List.Item>
            ))}
          </List>
          {entitlement && !entitlement.hasProAccess && (
            <Text size="sm" c="orange.6">
              You're on the free plan ({entitlement.freeLeaguesUsed} of{" "}
              {entitlement.freeLeagueLimit} leagues created this year) -
              deleting this league won't free up a slot for a new one.{" "}
              <Anchor component={Link} to="/billing" size="sm">
                Upgrade to Pro
              </Anchor>{" "}
              for unlimited leagues.
            </Text>
          )}
          {deleteError && (
            <Text c="red" size="sm">
              {deleteError}
            </Text>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleteModalOpen(false)}>
              Cancel
            </Button>
            <Button color="red" loading={isDeleting} onClick={handleDelete}>
              Delete League
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
