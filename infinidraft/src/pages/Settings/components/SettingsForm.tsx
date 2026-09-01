import {
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Chip,
  Divider,
  Grid,
  Group,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { LockedNotice } from "../../../components/LockedNotice";
import {
  CountStepper,
  EditableNumberStepper,
} from "../../../components/NumberStepper";
import { SNAKE_DRAFT_ENABLED } from "../../../lib/featureFlags";
import {
  POSITIONS,
  type Position,
  type ScoringFormat,
  type TeScoringFormat,
} from "../../../types";
import {
  POSITION_COLORS,
  positionColorOrDefault,
} from "@shared/positionColors";
import {
  DRAFT_TYPE_OPTIONS,
  PASSING_TD_OPTIONS,
  ROSTER_SLOT_KEYS,
  SCORING_OPTIONS,
  TE_SCORING_OPTIONS,
  type LeagueSettingsFormValues,
} from "../../../constants/leagueSettings";
import type { DraftTypeFormat } from "../../../types";

interface SettingsFormProps {
  form: LeagueSettingsFormValues;
  onChange: (form: LeagueSettingsFormValues) => void;
  error: string | null;
  isSaving: boolean;
  onSave: () => void;
  onCancel: () => void;
  // Overrides the Save button's label - e.g. LeagueImportWizard.tsx uses
  // this form purely as the "review the imported settings" step of a bigger
  // multi-part create action, so "Save" alone would undersell what clicking
  // it actually does.
  saveLabel?: string;
  // True once this season's seasonTeams rows already exist - the Teams
  // count can only change in lockstep with those rows from that point on
  // (see convex/draft/teams.ts's removeSeasonTeam and updateSeason's guard
  // in convex/leagues.ts), so editing it here would just be rejected on
  // save.
  teamsLocked?: boolean;
  // True once the draft has started - see convex/leagues.ts's updateSeason,
  // which now rejects a save that changes any of the fields disabled below
  // (everything except name). Only `name` stays editable in the form itself;
  // team names/salary cap overrides/nomination order live in TeamsPanel, not
  // here, and stay editable regardless (see LeagueDetails.tsx).
  configLocked?: boolean;
  // Only supplied by LeagueDetails.tsx, for both its create and edit
  // usages - not by the import wizards (LeagueImportWizard/
  // YahooLeagueImportWizard), which don't offer this toggle at all.
  // Editing an existing league saves immediately on change (a live
  // setUseKeepers mutation), independent of this form's own Save/Cancel -
  // not part of `form`/onSave's payload. Creating a brand-new league has
  // no id yet for that live mutation, so LeagueDetails.tsx wires this to
  // local form.useKeepers state instead, which rides along with the rest
  // of the form on Save.
  useKeepersControl?: {
    checked: boolean;
    onChange: (checked: boolean) => void;
    error: string | null;
    // Locked read-only - either free-plan (Pro-only, see convex/leagues.ts's
    // setUseKeepers) or configLocked (draft started). lockedMessage picks
    // which explanation to show; defaults to the Pro-upgrade copy if
    // disabled is true and no message is given.
    disabled?: boolean;
    lockedMessage?: ReactNode;
  };
  // True for the two import wizards (LeagueImportWizard/
  // YahooLeagueImportWizard), which render this form as one step inside
  // their own maw={560} wizard shell - the wide two-column Scoring/Roster
  // layout below only has room to breathe on LeagueDetails.tsx's full-width
  // page, so this falls back to the original single-column stack instead of
  // squeezing two columns (and the Roster card's own 3-up slot grid inside
  // one of them) into ~260px.
  compact?: boolean;
  // Whether the Draft Type control renders at all (still further gated by
  // SNAKE_DRAFT_ENABLED below) - true for a brand-new league, or an
  // existing pre-draft one (see draftTypeControl below for how those two
  // cases differ). Once the draft has started, LeagueDetails.tsx stops
  // passing this at all - draftType is permanently locked in from that
  // point on, same as everything else configLocked covers.
  showDraftType?: boolean;
  // Only supplied by LeagueDetails.tsx for an EXISTING league - saves
  // immediately via a live setDraftType mutation (convex/leagues.ts),
  // independent of this form's own Save/Cancel, same pattern as
  // useKeepersControl above. A brand-new league has no id yet for that
  // live mutation, so LeagueDetails.tsx leaves this undefined and lets
  // form.draftType/onSave's payload handle it instead (see the plain
  // SegmentedControl branch below). setDraftType itself rejects the
  // change server-side once any draftPicks (including keepers) exist for
  // this draft - `error` surfaces that rejection, there's no client-side
  // `disabled` for it beyond the draft having started.
  draftTypeControl?: {
    checked: DraftTypeFormat;
    onChange: (value: DraftTypeFormat) => void;
    error?: string | null;
  };
}

export function SettingsForm({
  form,
  onChange,
  error,
  isSaving,
  onSave,
  onCancel,
  saveLabel = "Save",
  teamsLocked = false,
  configLocked = false,
  useKeepersControl,
  compact = false,
  showDraftType = false,
  draftTypeControl,
}: SettingsFormProps) {
  // SettingsForm is freshly mounted at the start of every edit session (see
  // LeagueDetails.tsx's isEditing early-return, and the import wizards'
  // equivalent step-gated rendering) and unmounts again on a successful
  // save, so a plain "has anything changed since mount" flag is all the
  // header status pill below needs - no saved/original form to diff
  // against, and nothing to reset on save.
  const [touched, setTouched] = useState(false);
  const handleChange = (next: LeagueSettingsFormValues) => {
    setTouched(true);
    onChange(next);
  };

  return (
    <Stack gap="md" py="sm" maw={compact ? 500 : 900}>
      <Group justify="space-between" align="center" wrap="wrap" gap="sm">
        <Title order={3}>{form.name || "Untitled League"}</Title>
        <Badge variant="light" color={touched ? "orange" : "teal"}>
          {touched ? "Unsaved changes" : "All changes saved"}
        </Badge>
      </Group>
      {configLocked && (
        <LockedNotice>
          Scoring, roster, and keeper rules are locked.
        </LockedNotice>
      )}
      <Card withBorder padding="md">
        <Stack gap="md">
          <Title order={5}>League Basics</Title>
          <Grid gutter="md">
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <TextInput
                label="Name"
                value={form.name}
                onChange={(event) =>
                  handleChange({ ...form, name: event.currentTarget.value })
                }
              />
            </Grid.Col>
            {/* SNAKE_DRAFT_ENABLED: feature-flagged off by default (see
                featureFlags.ts) - this is the one control that can ever
                set draftType away from "auction", so hiding it here alone
                keeps every snake-specific code path unreachable in prod
                until this is deliberately turned on. */}
            {showDraftType && SNAKE_DRAFT_ENABLED && (
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <Stack gap={4}>
                  <Text size="sm" fw={500}>
                    Draft Type
                  </Text>
                  <SegmentedControl
                    value={draftTypeControl ? draftTypeControl.checked : form.draftType}
                    onChange={(value) =>
                      draftTypeControl
                        ? draftTypeControl.onChange(value as DraftTypeFormat)
                        : handleChange({
                            ...form,
                            draftType: value as DraftTypeFormat,
                          })
                    }
                    data={DRAFT_TYPE_OPTIONS.map(({ label, value }) => ({
                      label,
                      value,
                    }))}
                  />
                  {draftTypeControl?.error && (
                    <Text c="red" size="xs">
                      {draftTypeControl.error}
                    </Text>
                  )}
                </Stack>
              </Grid.Col>
            )}
            <Grid.Col span={{ base: 6, sm: 3 }}>
              <Stack gap={4}>
                <Text size="sm" fw={500}>
                  Teams
                </Text>
                {teamsLocked ? (
                  <Text size="xs" c="dimmed">
                    Managed from the Teams panel
                  </Text>
                ) : null}
                <CountStepper
                  label="Teams"
                  min={1}
                  value={form.teamCount}
                  onChange={(value) =>
                    handleChange({
                      ...form,
                      teamCount: value ?? form.teamCount,
                    })
                  }
                  disabled={teamsLocked}
                />
              </Stack>
            </Grid.Col>
            {/* Not applicable outside auction - see SNAKE_DRAFT.md §2.1.
                Reads draftTypeControl.checked (live, when present) rather
                than form.draftType - an existing league's draftType now
                changes via that live control, not this form's own batched
                state, so form.draftType alone would stay stale (whatever
                it was when the edit session opened) if a host flips it and
                keeps editing. */}
            {(draftTypeControl ? draftTypeControl.checked : form.draftType) ===
              "auction" && (
              <Grid.Col span={{ base: 6, sm: 3 }}>
                <Stack gap={4}>
                  <Text size="sm" fw={500}>
                    Salary Cap
                  </Text>
                  <EditableNumberStepper
                    label="Salary Cap"
                    min={1}
                    prefix="$"
                    value={form.salaryCap}
                    onChange={(value) =>
                      handleChange({
                        ...form,
                        salaryCap: value ?? form.salaryCap,
                      })
                    }
                    disabled={configLocked}
                  />
                </Stack>
              </Grid.Col>
            )}
          </Grid>
        </Stack>
      </Card>

      <SimpleGrid cols={{ base: 1, md: compact ? 1 : 2 }} spacing="md">
        <Stack gap="md">
          <Card withBorder padding="md">
            <Stack gap="md">
              <Title order={5}>Scoring</Title>
              <Stack gap={6}>
                <Text size="sm" fw={500}>
                  Points per reception
                </Text>
                <SegmentedControl
                  value={form.scoring}
                  onChange={(value) =>
                    handleChange({ ...form, scoring: value as ScoringFormat })
                  }
                  data={SCORING_OPTIONS.map(({ label, value }) => ({
                    label,
                    value,
                  }))}
                  disabled={configLocked}
                />
              </Stack>
              <Stack gap={6}>
                <Text size="sm" fw={500}>
                  Passing TDs
                </Text>
                <SegmentedControl
                  value={form.sixPointPassTds ? "6" : "4"}
                  onChange={(value) =>
                    handleChange({ ...form, sixPointPassTds: value === "6" })
                  }
                  data={PASSING_TD_OPTIONS.map(({ label, value }) => ({
                    label,
                    value,
                  }))}
                  disabled={configLocked}
                />
              </Stack>
              <Stack gap={6}>
                <Text size="sm" fw={500}>
                  TE Premium
                </Text>
                <SegmentedControl
                  value={form.teScoring}
                  onChange={(value) =>
                    handleChange({
                      ...form,
                      teScoring: value as TeScoringFormat,
                    })
                  }
                  data={TE_SCORING_OPTIONS.map(({ label, value }) => ({
                    label,
                    value,
                  }))}
                  disabled={configLocked}
                />
              </Stack>
            </Stack>
          </Card>

          {useKeepersControl && (
            <Card withBorder padding="md">
              <Stack gap="md">
                <Title order={5}>Keepers</Title>
                <Stack gap={4}>
                  <Switch
                    label="Use Keepers"
                    description={
                      useKeepersControl.disabled
                        ? (useKeepersControl.lockedMessage ?? (
                            <>
                              Pro only.{" "}
                              <Anchor component={Link} to="/billing" size="xs">
                                Upgrade to enable keepers.
                              </Anchor>
                            </>
                          ))
                        : undefined
                    }
                    checked={useKeepersControl.checked}
                    disabled={useKeepersControl.disabled}
                    onChange={(event) =>
                      useKeepersControl.onChange(event.currentTarget.checked)
                    }
                  />
                  {useKeepersControl.error && (
                    <Text c="red" size="sm">
                      {useKeepersControl.error}
                    </Text>
                  )}
                </Stack>
              </Stack>
            </Card>
          )}
        </Stack>

        <Card withBorder padding="md">
          <Stack gap="md">
            <Title order={5}>Roster</Title>
            <Stack gap={6}>
              <Text size="sm" fw={500}>
                Roster Slots
              </Text>
              {/* 3 columns of CountSteppers (now STEPPER_BUTTON_SIZE-wide +/-
                  buttons each) don't fit a mobile viewport without
                  overlapping - 2 up narrow, same 3 from "sm" up where
                  there's room, to keep one slot's + button from crowding
                  the next slot's - button. */}
              <SimpleGrid
                cols={{ base: 2, sm: 3 }}
                spacing="md"
                verticalSpacing="md"
              >
                {ROSTER_SLOT_KEYS.map((key) => (
                  <Box
                    key={key}
                    p={8}
                    style={{
                      border: "1px solid var(--mantine-color-default-border)",
                      borderRadius: "var(--mantine-radius-md)",
                    }}
                  >
                    <Stack gap={4}>
                      <Badge
                        size="sm"
                        variant="light"
                        color={positionColorOrDefault(key)}
                        style={{ alignSelf: "flex-start" }}
                      >
                        {key}
                      </Badge>
                      <CountStepper
                        label={key}
                        value={form.rosterSlots[key]}
                        onChange={(value) =>
                          handleChange({
                            ...form,
                            rosterSlots: {
                              ...form.rosterSlots,
                              [key]: value ?? 0,
                            },
                          })
                        }
                        disabled={configLocked}
                      />
                    </Stack>
                  </Box>
                ))}
              </SimpleGrid>
            </Stack>
            {form.rosterSlots.FLEX > 0 && (
              <>
                <Divider />
                <Stack gap={6}>
                  <Group gap={6} wrap="nowrap">
                    <Badge
                      size="sm"
                      variant="light"
                      color={positionColorOrDefault("FLEX")}
                    >
                      FLEX
                    </Badge>
                    <Text size="sm" fw={500}>
                      eligible positions
                    </Text>
                  </Group>
                  <Chip.Group
                    multiple
                    value={form.flexPositions}
                    onChange={(value) =>
                      handleChange({
                        ...form,
                        flexPositions: value as Position[],
                      })
                    }
                  >
                    <Group gap="xs">
                      {POSITIONS.map((pos) => (
                        <Chip
                          key={pos}
                          value={pos}
                          color={POSITION_COLORS[pos]}
                          variant="light"
                          disabled={configLocked}
                        >
                          {pos}
                        </Chip>
                      ))}
                    </Group>
                  </Chip.Group>
                </Stack>
              </>
            )}
            {form.rosterSlots.SUPERFLEX > 0 && (
              <Stack gap={6}>
                <Group gap={6} wrap="nowrap">
                  <Badge
                    size="sm"
                    variant="light"
                    color={positionColorOrDefault("SUPERFLEX")}
                  >
                    SUPERFLEX
                  </Badge>
                  <Text size="sm" fw={500}>
                    eligible positions
                  </Text>
                </Group>
                <Chip.Group
                  multiple
                  value={form.superflexPositions}
                  onChange={(value) =>
                    handleChange({
                      ...form,
                      superflexPositions: value as Position[],
                    })
                  }
                >
                  <Group gap="xs">
                    {POSITIONS.map((pos) => (
                      <Chip
                        key={pos}
                        value={pos}
                        color={POSITION_COLORS[pos]}
                        variant="light"
                        disabled={configLocked}
                      >
                        {pos}
                      </Chip>
                    ))}
                  </Group>
                </Chip.Group>
              </Stack>
            )}
          </Stack>
        </Card>
      </SimpleGrid>

      {error && (
        <Text c="red" size="sm">
          {error}
        </Text>
      )}
      <Group>
        <Button onClick={onSave} loading={isSaving}>
          {saveLabel}
        </Button>
        <Button variant="default" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
      </Group>
    </Stack>
  );
}
