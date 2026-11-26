import { useState } from "react";
import { useMutation } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { Button, Group, NumberInput, Select, Stack, Switch, Text } from "@mantine/core";
import { api } from "@infinidata/api";
import { bracketRoundCount } from "@playoffRules/bracketMath";
import { roundName } from "@playoffRules/evaluate";
import type { PlayoffFormat, PresetConfig } from "@playoffRules/format";
import {
  defaultDoubleElim,
  defaultStandard,
  defaultWorldCup,
  presetFormat,
  WORLD_CUP_TEAMS,
} from "@playoffRules/presets";
import { formatProblem } from "@playoffRules/validate";
import { getErrorMessage } from "@shared/errors";
import { GlassSegmented } from "@shared/glass/GlassSegmented";
import glass from "@shared/glass/GlassMatchupCard.module.css";
import { describeFormat } from "../lib/describeFormat";
import type { SeasonData } from "../lib/seasonData";

type Kind = "platform" | PresetConfig["kind"] | "custom";

type StandardConfig = Extract<PresetConfig, { kind: "standard" }>;
type WorldCupConfig = Extract<PresetConfig, { kind: "worldCup" }>;
type DoubleElimConfig = Extract<PresetConfig, { kind: "doubleElim" }>;

const TIERS = ["S", "A", "B", "C"] as const;

// The commissioner's rules form: the platform's own playoffs, or a preset
// adjusted here. The preview is the saved rules page's own text.
export function RulesEditor({
  seasonId,
  data,
  saved,
  resets,
}: {
  seasonId: Id<"seasons">;
  data: SeasonData;
  saved: PlayoffFormat | null;
  // What saving throws away, e.g. "the matchup draft" - null for nothing.
  resets: string | null;
}) {
  const setFormat = useMutation(api.infiniyoffs.rules.setFormat);
  const teamCount = data.teams.length;
  const platform = data.platformPlayoffs;
  const platformEnd = platform?.regularSeasonEndWeek ?? data.platformRegularSeasonEndWeek;
  const platformTeams = platform?.playoffTeamCount || Math.min(6, teamCount);

  const savedKind: Kind = saved === null ? "platform" : (saved.preset?.kind ?? "custom");
  const [kind, setKind] = useState<Kind>(savedKind);
  const [standard, setStandard] = useState<StandardConfig>(
    saved?.preset?.kind === "standard" ? saved.preset : defaultStandard(platformEnd, platformTeams),
  );
  const [doubleElim, setDoubleElim] = useState<DoubleElimConfig>(
    saved?.preset?.kind === "doubleElim"
      ? saved.preset
      : defaultDoubleElim(Math.min(platformEnd, 13), teamCount),
  );
  const [worldCup, setWorldCup] = useState<WorldCupConfig>(
    saved?.preset?.kind === "worldCup" ? saved.preset : defaultWorldCup(),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const built: PlayoffFormat | null =
    kind === "standard"
      ? presetFormat(standard, teamCount)
      : kind === "doubleElim"
        ? presetFormat(doubleElim, teamCount)
        : kind === "worldCup"
          ? presetFormat(worldCup, teamCount)
          : kind === "custom"
            ? saved
            : null;
  const problem = built ? formatProblem(built, teamCount) : null;
  // The preview only once it says something the saved rules above don't.
  // (Key order differs - the database returns keys sorted.)
  const changed = canonical(built) !== canonical(saved);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await setFormat({ seasonId, format: built });
      setSavedAt(Date.now());
    } catch (err) {
      setError(getErrorMessage(err, "Failed to save the rules."));
    } finally {
      setSaving(false);
    }
  };

  const kindOptions: { value: Kind; label: string }[] = [
    { value: "platform", label: "Platform" },
    { value: "standard", label: "Bracket" },
    { value: "doubleElim", label: "Double elim" },
    ...(teamCount === WORLD_CUP_TEAMS ? [{ value: "worldCup" as const, label: "World Cup" }] : []),
    ...(savedKind === "custom" ? [{ value: "custom" as const, label: "Custom" }] : []),
  ];

  return (
    <div className={glass.card}>
      <Stack gap="md" p={4}>
        <span className={glass.sectionLabel}>Edit rules</span>
        <GlassSegmented label="Format" value={kind} onChange={setKind} options={kindOptions} />

        {kind === "platform" && (
          <Text size="sm" c="dimmed">
            {platform?.hasPlayoffs
              ? `The platform's own playoffs: ${platform.playoffTeamCount} teams ` +
                `from week ${platformEnd + 1}.`
              : "The platform's own playoffs."}
          </Text>
        )}
        {kind === "standard" && (
          <StandardForm config={standard} onChange={setStandard} teamCount={teamCount} />
        )}
        {kind === "doubleElim" && (
          <DoubleElimForm config={doubleElim} onChange={setDoubleElim} teamCount={teamCount} />
        )}
        {kind === "worldCup" && <WorldCupForm config={worldCup} onChange={setWorldCup} />}

        {built && changed && (
          <Stack gap={4}>
            <span className={glass.sectionLabel}>Preview</span>
            {describeFormat(built).map((line) => (
              <Text key={line} size="sm" c="dimmed">
                {line}
              </Text>
            ))}
          </Stack>
        )}
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
        <Group justify="space-between" wrap="nowrap">
          <Text size="xs" c="dimmed">
            {resets ? `Saving resets ${resets}.` : savedAt ? "Saved." : ""}
          </Text>
          <Button onClick={() => void save()} loading={saving} disabled={problem !== null}>
            Save rules
          </Button>
        </Group>
      </Stack>
    </div>
  );
}

// JSON with object keys sorted, for comparing formats.
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, inner: unknown) =>
    inner && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b)))
      : inner,
  );
}

function WeekInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <NumberInput
      label={label}
      value={value}
      min={1}
      max={17}
      allowDecimal={false}
      onChange={(next) => typeof next === "number" && onChange(next)}
    />
  );
}

function StandardForm({
  config,
  onChange,
  teamCount,
}: {
  config: StandardConfig;
  onChange: (config: StandardConfig) => void;
  teamCount: number;
}) {
  const set = (patch: Partial<StandardConfig>) => onChange({ ...config, ...patch });
  const rounds = bracketRoundCount(config.playoffTeams);
  const setBonus = (seed: number, round: number, value: number) => {
    const perRound = Array.from({ length: rounds }, (_, r) => config.seedBonus[seed]?.[r] ?? 0);
    perRound[round] = value;
    set({ seedBonus: { ...config.seedBonus, [seed]: perRound } });
  };

  return (
    <Stack gap="sm">
      <Group grow>
        <WeekInput
          label="Regular season ends"
          value={config.regularSeasonEndWeek}
          onChange={(regularSeasonEndWeek) => set({ regularSeasonEndWeek })}
        />
        <NumberInput
          label="Playoff teams"
          value={config.playoffTeams}
          min={2}
          max={teamCount}
          allowDecimal={false}
          onChange={(next) =>
            typeof next === "number" &&
            set({ playoffTeams: next, wildcards: Math.min(config.wildcards, next - 1) })
          }
        />
      </Group>
      <Group grow>
        <NumberInput
          label="Wildcards on points"
          value={config.wildcards}
          min={0}
          max={config.playoffTeams - 1}
          allowDecimal={false}
          onChange={(next) => typeof next === "number" && set({ wildcards: next })}
        />
        <Select
          label="Seeding"
          value={config.seeding}
          allowDeselect={false}
          data={[
            { value: "record", label: "Record" },
            { value: "points", label: "Points only" },
          ]}
          onChange={(next) => next && set({ seeding: next as StandardConfig["seeding"] })}
        />
      </Group>
      <Switch
        label="Two-week rounds"
        checked={config.weeksPerRound === 2}
        onChange={(event) => set({ weeksPerRound: event.currentTarget.checked ? 2 : 1 })}
      />
      <Switch
        label="Reseed each round"
        checked={config.reseed}
        onChange={(event) => set({ reseed: event.currentTarget.checked })}
      />
      <Switch
        label="Toilet bowl for everyone else"
        checked={config.toiletBowl}
        onChange={(event) => set({ toiletBowl: event.currentTarget.checked })}
      />

      <span className={glass.sectionLabel}>Seed bonus by round</span>
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
    </Stack>
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

function DoubleElimForm({
  config,
  onChange,
  teamCount,
}: {
  config: DoubleElimConfig;
  onChange: (config: DoubleElimConfig) => void;
  teamCount: number;
}) {
  const set = (patch: Partial<DoubleElimConfig>) => onChange({ ...config, ...patch });
  return (
    <Stack gap="sm">
      <Group grow>
        <WeekInput
          label="Regular season ends"
          value={config.regularSeasonEndWeek}
          onChange={(regularSeasonEndWeek) => set({ regularSeasonEndWeek })}
        />
        <NumberInput
          label="Playoff teams"
          value={config.playoffTeams}
          min={3}
          max={teamCount}
          allowDecimal={false}
          onChange={(next) => typeof next === "number" && set({ playoffTeams: next })}
        />
      </Group>
      <Group grow>
        <NumberInput
          label="Bracket weeks"
          description="Before the Royal Rumble"
          value={config.bracketWeeks}
          min={1}
          max={6}
          allowDecimal={false}
          onChange={(next) => typeof next === "number" && set({ bracketWeeks: next })}
        />
        <SeedingSelect value={config.seeding} onChange={(seeding) => set({ seeding })} />
      </Group>
    </Stack>
  );
}

function WorldCupForm({
  config,
  onChange,
}: {
  config: WorldCupConfig;
  onChange: (config: WorldCupConfig) => void;
}) {
  return (
    <Stack gap="sm">
      <WeekInput
        label="Regular season ends"
        value={config.regularSeasonEndWeek}
        onChange={(regularSeasonEndWeek) => onChange({ ...config, regularSeasonEndWeek })}
      />
      <span className={glass.sectionLabel}>Weekly tier bonus</span>
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
    </Stack>
  );
}
