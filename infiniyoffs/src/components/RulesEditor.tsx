import { useState, type ReactNode } from "react";
import { useMutation } from "convex/react";
import type { GenericId as Id } from "convex/values";
import {
  Accordion,
  Badge,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { api } from "@infinidata/api";
import { canonicalJson } from "@playoffRules/carryOver";
import type { PlayoffFormat, PresetConfig } from "@playoffRules/format";
import { presetFormat } from "@playoffRules/presets";
import { formatProblem } from "@playoffRules/validate";
import { getErrorMessage } from "@shared/errors";
import glass from "@shared/glass/GlassMatchupCard.module.css";
import {
  PLAYOFF_TYPES,
  resetsBySaving,
  typeAllowed,
  savedKind,
  typeFormat,
  type Kind,
} from "../lib/rulesConfig";
import type { PlayoffRules, SeasonData } from "../lib/seasonData";
import {
  BracketWeeksInput,
  DoubleElimTeams,
  SeedBonusGrid,
  StandardTeams,
  StartWeekInput,
  TierBonus,
} from "./RulesFields";

type StandardConfig = Extract<PresetConfig, { kind: "standard" }>;
type DoubleElimConfig = Extract<PresetConfig, { kind: "doubleElim" }>;


// Saves a format, asking first when the save would discard the draft or
// hand-set groups. Renders the confirm dialog it opens.
function useSaveFormat(seasonId: Id<"seasons">, rules: PlayoffRules) {
  const setFormat = useMutation(api.infiniyoffs.rules.setFormat);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{
    format: PlayoffFormat | null;
    resets: string;
    onSaved: () => void;
  } | null>(null);

  const commit = async (format: PlayoffFormat | null, onSaved: () => void) => {
    setConfirming(null);
    setSaving(true);
    setError(null);
    try {
      await setFormat({ seasonId, format });
      onSaved();
    } catch (err) {
      setError(getErrorMessage(err, "Failed to save the rules."));
    } finally {
      setSaving(false);
    }
  };

  const save = (format: PlayoffFormat | null, onSaved: () => void = () => {}) => {
    const resets = resetsBySaving(rules, format);
    if (resets) setConfirming({ format, resets, onSaved });
    else void commit(format, onSaved);
  };

  const dialog = (
    <Modal
      opened={confirming !== null}
      onClose={() => setConfirming(null)}
      title="Save and reset?"
      centered
    >
      <Stack gap="md">
        <Text size="sm">This change resets {confirming?.resets}.</Text>
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={() => setConfirming(null)}>
            Cancel
          </Button>
          <Button
            color="red"
            onClick={() => confirming && void commit(confirming.format, confirming.onSaved)}
          >
            Save and reset
          </Button>
        </Group>
      </Stack>
    </Modal>
  );

  return { save, saving, error, dialog };
}


// The playoff type on its own card: each type explained in an accordion,
// then a pick and a save. Nothing changes until it's saved.
export function PlayoffTypeCard({
  seasonId,
  data,
  rules,
  saved,
  kind,
  onKindChange,
}: {
  seasonId: Id<"seasons">;
  data: SeasonData;
  rules: PlayoffRules;
  saved: PlayoffFormat | null;
  // The picked type - the page's, so the preview can show it.
  kind: Kind;
  onKindChange: (kind: Kind) => void;
}) {
  const current = savedKind(saved);
  const [open, setOpen] = useState<string | null>(kind);
  const { save, saving, error, dialog } = useSaveFormat(seasonId, rules);
  const allowed = (k: Kind) => typeAllowed(k, data.teams.length, current);
  const types = PLAYOFF_TYPES.filter((type) => type.kind !== "custom" || current === "custom");
  const next = typeFormat(kind, data, saved);
  const problem = next ? formatProblem(next, data.teams.length) : null;

  return (
    <div className={glass.card}>
      <Stack gap="sm" p={4}>
        <span className={glass.sectionLabel}>Playoff type</span>
        <Accordion value={open} onChange={setOpen} variant="default" chevronPosition="right">
          {types.map((type) => (
            <Accordion.Item key={type.kind} value={type.kind}>
              <Accordion.Control px={4}>
                <Group gap={8} wrap="nowrap">
                  <Text size="sm" fw={600} {...(allowed(type.kind) ? {} : { c: "dimmed" })}>
                    {type.label(data)}
                  </Text>
                  {type.kind === current && (
                    <Badge size="xs" variant="light">
                      Current
                    </Badge>
                  )}
                </Group>
              </Accordion.Control>
              <Accordion.Panel>
                <Text size="sm" c="dimmed">
                  {type.about(data)}
                </Text>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
        <Group gap="xs" wrap="nowrap">
          <Select
            aria-label="Playoff type"
            style={{ flex: 1 }}
            value={kind}
            allowDeselect={false}
            data={types.map((type) => ({
              value: type.kind,
              label: type.label(data),
              disabled: !allowed(type.kind),
            }))}
            onChange={(value) => {
              if (!value) return;
              onKindChange(value as Kind);
              setOpen(value);
            }}
          />
          <Button
            disabled={kind === current || problem !== null}
            loading={saving}
            onClick={() => save(next)}
          >
            Save type
          </Button>
        </Group>
        {problem && kind !== current && (
          <Text size="sm" c="red">
            {problem}
          </Text>
        )}
        {error && (
          <Text size="sm" c="red">
            {error}
          </Text>
        )}
      </Stack>
      {dialog}
    </div>
  );
}

// One card of a preset's settings. `fields` are the config keys it owns:
// Save writes just those over the saved config, so another card's unsaved
// edits stay unsaved.
function OptionsCard({
  title,
  fields,
  seasonId,
  data,
  rules,
  saved,
  pending,
  onPendingChange,
  children,
}: {
  title: string;
  fields: string[];
  seasonId: Id<"seasons">;
  data: SeasonData;
  rules: PlayoffRules;
  saved: PresetConfig;
  pending: PresetConfig;
  onPendingChange: (config: PresetConfig) => void;
  children: ReactNode;
}) {
  const { save, saving, error, dialog } = useSaveFormat(seasonId, rules);
  const savedValues = saved as unknown as Record<string, unknown>;
  const pendingValues = pending as unknown as Record<string, unknown>;
  const dirty = fields.some(
    (field) => canonicalJson(pendingValues[field]) !== canonicalJson(savedValues[field]),
  );
  const next = {
    ...saved,
    ...Object.fromEntries(fields.map((field) => [field, pendingValues[field]])),
  } as PresetConfig;
  const format = presetFormat(next, data.teams.length);
  const problem = dirty ? formatProblem(format, data.teams.length) : null;
  const undo = () =>
    onPendingChange({
      ...pending,
      ...Object.fromEntries(fields.map((field) => [field, savedValues[field]])),
    } as PresetConfig);

  return (
    <div className={glass.card}>
      <Stack gap="sm" p={4}>
        <span className={glass.sectionLabel}>{title}</span>
        {children}
        {problem && (
          <Text size="sm" c="red">
            {problem}
          </Text>
        )}
        {error && (
          <Text size="sm" c="red">
            {error}
          </Text>
        )}
        {dirty && (
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={undo}>
              Undo
            </Button>
            <Button loading={saving} disabled={problem !== null} onClick={() => save(format)}>
              Save
            </Button>
          </Group>
        )}
      </Stack>
      {dialog}
    </div>
  );
}

// The saved preset's settings, split into cards that each save alone.
export function PresetCards({
  seasonId,
  data,
  rules,
  saved,
  pending,
  onPendingChange,
}: {
  seasonId: Id<"seasons">;
  data: SeasonData;
  rules: PlayoffRules;
  saved: PresetConfig;
  pending: PresetConfig;
  onPendingChange: (config: PresetConfig) => void;
}) {
  const teamCount = data.teams.length;
  const card = (title: string, fields: string[], body: ReactNode) => (
    <OptionsCard
      key={title}
      title={title}
      fields={fields}
      seasonId={seasonId}
      data={data}
      rules={rules}
      saved={saved}
      pending={pending}
      onPendingChange={onPendingChange}
    >
      {body}
    </OptionsCard>
  );

  switch (pending.kind) {
    case "standard": {
      const set = (patch: Partial<StandardConfig>) => onPendingChange({ ...pending, ...patch });
      return (
        <>
          {card(
            "Schedule",
            ["regularSeasonEndWeek", "weeksPerRound"],
            <>
              <StartWeekInput config={pending} onChange={onPendingChange} />
              <Switch
                label="Two-week rounds"
                checked={pending.weeksPerRound === 2}
                onChange={(event) => set({ weeksPerRound: event.currentTarget.checked ? 2 : 1 })}
              />
            </>,
          )}
          {card(
            "Teams & seeding",
            ["playoffTeams", "wildcards", "seeding", "reseed", "toiletBowl"],
            <StandardTeams config={pending} onChange={set} teamCount={teamCount} />,
          )}
          {card(
            "Seed bonus by round",
            ["seedBonus"],
            <SeedBonusGrid config={pending} onChange={set} />,
          )}
        </>
      );
    }
    case "doubleElim": {
      const set = (patch: Partial<DoubleElimConfig>) => onPendingChange({ ...pending, ...patch });
      return (
        <>
          {card(
            "Schedule",
            ["regularSeasonEndWeek", "bracketWeeks"],
            <Group grow align="flex-start">
              <StartWeekInput config={pending} onChange={onPendingChange} />
              <BracketWeeksInput config={pending} onChange={set} />
            </Group>,
          )}
          {card(
            "Teams & seeding",
            ["playoffTeams", "seeding"],
            <DoubleElimTeams config={pending} onChange={set} teamCount={teamCount} />,
          )}
        </>
      );
    }
    case "worldCup":
      return (
        <>
          {card(
            "Schedule",
            ["regularSeasonEndWeek"],
            <StartWeekInput config={pending} onChange={onPendingChange} />,
          )}
          {card(
            "Weekly tier bonus",
            ["tierBonus"],
            <TierBonus config={pending} onChange={onPendingChange} />,
          )}
        </>
      );
  }
}
