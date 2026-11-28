import { Group, NumberInput, Select, Switch, Text } from "@mantine/core";
import { bracketRoundCount } from "@playoffRules/bracketMath";
import { roundName } from "@playoffRules/evaluate";
import type { PresetConfig } from "@playoffRules/format";
import { LAST_WEEK } from "../lib/rulesConfig";

// The rules form's inputs, shared by the Settings cards (RulesEditor.tsx)
// and the setup flow's steps.

type StandardConfig = Extract<PresetConfig, { kind: "standard" }>;
type WorldCupConfig = Extract<PresetConfig, { kind: "worldCup" }>;
type DoubleElimConfig = Extract<PresetConfig, { kind: "doubleElim" }>;

const TIERS = ["S", "A", "B", "C"] as const;

// The week the playoffs start - the regular season's last week plus one.
export function StartWeekInput({
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

export function StandardTeams({
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

export function SeedBonusGrid({
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

export function SeedingSelect({
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

export function TierBonus({
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

export function BracketWeeksInput({
  config,
  onChange,
}: {
  config: DoubleElimConfig;
  onChange: (patch: Partial<DoubleElimConfig>) => void;
}) {
  return (
    <NumberInput
      label="Bracket weeks"
      description="Before the Rumble"
      value={config.bracketWeeks}
      min={1}
      max={6}
      allowDecimal={false}
      onChange={(next) => typeof next === "number" && onChange({ bracketWeeks: next })}
    />
  );
}

export function DoubleElimTeams({
  config,
  onChange,
  teamCount,
}: {
  config: DoubleElimConfig;
  onChange: (patch: Partial<DoubleElimConfig>) => void;
  teamCount: number;
}) {
  return (
    <Group grow align="flex-start">
      <NumberInput
        label="Playoff teams"
        value={config.playoffTeams}
        min={3}
        max={teamCount}
        allowDecimal={false}
        onChange={(next) => typeof next === "number" && onChange({ playoffTeams: next })}
      />
      <SeedingSelect value={config.seeding} onChange={(seeding) => onChange({ seeding })} />
    </Group>
  );
}
