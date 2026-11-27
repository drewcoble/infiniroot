import { useState, type ReactNode } from "react";
import { useMutation } from "convex/react";
import type { GenericId as Id } from "convex/values";
import {
  Accordion,
  Badge,
  Button,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { api } from "@infinidata/api";
import { bracketRoundCount } from "@playoffRules/bracketMath";
import { canonicalJson } from "@playoffRules/carryOver";
import { roundName } from "@playoffRules/evaluate";
import type { PlayoffFormat, PresetConfig } from "@playoffRules/format";
import { presetFormat, WORLD_CUP_TEAMS } from "@playoffRules/presets";
import { formatProblem } from "@playoffRules/validate";
import { getErrorMessage } from "@shared/errors";
import glass from "@shared/glass/GlassMatchupCard.module.css";
import {
  LAST_WEEK,
  resetsBySaving,
  savedKind,
  typeFormat,
  type Kind,
} from "../lib/rulesConfig";
import type { PlayoffRules, SeasonData } from "../lib/seasonData";

type StandardConfig = Extract<PresetConfig, { kind: "standard" }>;
type WorldCupConfig = Extract<PresetConfig, { kind: "worldCup" }>;
type DoubleElimConfig = Extract<PresetConfig, { kind: "doubleElim" }>;

const TIERS = ["S", "A", "B", "C"] as const;

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

const TYPE_INFO: {
  kind: Kind;
  label: (data: SeasonData) => string;
  about: (data: SeasonData) => string;
}[] = [
  {
    kind: "platform",
    label: (data) => `Follow ${data.platformName ?? "the platform"}`,
    about: (data) =>
      data.platformPlayoffs?.hasPlayoffs
        ? `Your league's own bracket: ${data.platformPlayoffs.playoffTeamCount} teams from ` +
          `week ${data.platformPlayoffs.regularSeasonEndWeek + 1}.`
        : "Your league's own playoffs, as set on its platform.",
  },
  {
    kind: "standard",
    label: () => "Single elimination",
    about: () => "Single elimination, with byes for the top seeds.",
  },
  {
    kind: "doubleElim",
    label: () => "Double elimination",
    about: () => "Two losses and you're out, then a Royal Rumble for everyone left.",
  },
  {
    kind: "worldCup",
    label: () => "World Cup",
    about: () =>
      "Top seeds draft groups of four; group winners and a wildcard play a knockout. " +
      "12 teams only.",
  },
  { kind: "custom", label: () => "Custom", about: () => "Rules set up by hand." },
];

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
  const allowed = (k: Kind) =>
    k === "custom"
      ? current === "custom"
      : k !== "worldCup" || data.teams.length === WORLD_CUP_TEAMS;
  const types = TYPE_INFO.filter((type) => type.kind !== "custom" || current === "custom");
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
              <NumberInput
                label="Bracket weeks"
                description="Before the Rumble"
                value={pending.bracketWeeks}
                min={1}
                max={6}
                allowDecimal={false}
                onChange={(next) => typeof next === "number" && set({ bracketWeeks: next })}
              />
            </Group>,
          )}
          {card(
            "Teams & seeding",
            ["playoffTeams", "seeding"],
            <Group grow align="flex-start">
              <NumberInput
                label="Playoff teams"
                value={pending.playoffTeams}
                min={3}
                max={teamCount}
                allowDecimal={false}
                onChange={(next) => typeof next === "number" && set({ playoffTeams: next })}
              />
              <SeedingSelect value={pending.seeding} onChange={(seeding) => set({ seeding })} />
            </Group>,
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

// The week the playoffs start - the regular season's last week plus one.
function StartWeekInput({
  config,
  onChange,
}: {
  config: PresetConfig;
  onChange: (config: PresetConfig) => void;
}) {
  return (
    <NumberInput
      label="Playoffs start"
      prefix="Week "
      value={config.regularSeasonEndWeek + 1}
      min={2}
      max={LAST_WEEK}
      allowDecimal={false}
      onChange={(next) =>
        typeof next === "number" && onChange({ ...config, regularSeasonEndWeek: next - 1 })
      }
    />
  );
}

function StandardTeams({
  config,
  onChange,
  teamCount,
}: {
  config: StandardConfig;
  onChange: (patch: Partial<StandardConfig>) => void;
  teamCount: number;
}) {
  return (
    <>
      <Group grow align="flex-start">
        <NumberInput
          label="Playoff teams"
          value={config.playoffTeams}
          min={2}
          max={teamCount}
          allowDecimal={false}
          onChange={(next) =>
            typeof next === "number" &&
            onChange({ playoffTeams: next, wildcards: Math.min(config.wildcards, next - 1) })
          }
        />
        <NumberInput
          label="Wildcards on points"
          value={config.wildcards}
          min={0}
          max={config.playoffTeams - 1}
          allowDecimal={false}
          onChange={(next) => typeof next === "number" && onChange({ wildcards: next })}
        />
      </Group>
      <SeedingSelect value={config.seeding} onChange={(seeding) => onChange({ seeding })} />
      <Switch
        label="Reseed each round"
        checked={config.reseed}
        onChange={(event) => onChange({ reseed: event.currentTarget.checked })}
      />
      <Switch
        label="Toilet bowl for everyone else"
        checked={config.toiletBowl}
        onChange={(event) => onChange({ toiletBowl: event.currentTarget.checked })}
      />
    </>
  );
}

function SeedBonusGrid({
  config,
  onChange,
}: {
  config: StandardConfig;
  onChange: (patch: Partial<StandardConfig>) => void;
}) {
  const rounds = bracketRoundCount(config.playoffTeams);
  const setBonus = (seed: number, round: number, value: number) => {
    const perRound = Array.from({ length: rounds }, (_, r) => config.seedBonus[seed]?.[r] ?? 0);
    perRound[round] = value;
    onChange({ seedBonus: { ...config.seedBonus, [seed]: perRound } });
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `auto repeat(${rounds}, minmax(0, 1fr))`,
        gap: 6,
        alignItems: "center",
      }}
    >
      <span />
      {Array.from({ length: rounds }, (_, r) => (
        <Text key={r} size="xs" c="dimmed" ta="center" truncate>
          {roundName(r + 1, rounds)}
        </Text>
      ))}
      {Array.from({ length: config.playoffTeams }, (_, i) => i + 1).map((seed) => (
        <SeedBonusRow
          key={seed}
          seed={seed}
          rounds={rounds}
          values={config.seedBonus[seed] ?? []}
          onChange={(round, value) => setBonus(seed, round, value)}
        />
      ))}
    </div>
  );
}

function SeedBonusRow({
  seed,
  rounds,
  values,
  onChange,
}: {
  seed: number;
  rounds: number;
  values: number[];
  onChange: (round: number, value: number) => void;
}) {
  return (
    <>
      <Text size="sm" fw={600} className="num">
        #{seed}
      </Text>
      {Array.from({ length: rounds }, (_, r) => (
        <NumberInput
          key={r}
          size="xs"
          hideControls
          value={values[r] ?? 0}
          aria-label={`Seed ${seed} bonus, round ${r + 1}`}
          onChange={(next) => onChange(r, typeof next === "number" ? next : 0)}
        />
      ))}
    </>
  );
}

function SeedingSelect({
  value,
  onChange,
}: {
  value: "record" | "points";
  onChange: (value: "record" | "points") => void;
}) {
  return (
    <Select
      label="Seeding"
      value={value}
      allowDeselect={false}
      data={[
        { value: "record", label: "Record" },
        { value: "points", label: "Points only" },
      ]}
      onChange={(next) => next && onChange(next as "record" | "points")}
    />
  );
}

function TierBonus({
  config,
  onChange,
}: {
  config: WorldCupConfig;
  onChange: (config: WorldCupConfig) => void;
}) {
  return (
    <Group grow>
      {TIERS.map((tier, i) => (
        <NumberInput
          key={tier}
          label={tier}
          hideControls
          value={config.tierBonus[i] ?? 0}
          onChange={(next) => {
            const tierBonus = [...config.tierBonus] as WorldCupConfig["tierBonus"];
            tierBonus[i] = typeof next === "number" ? next : 0;
            onChange({ ...config, tierBonus });
          }}
        />
      ))}
    </Group>
  );
}
