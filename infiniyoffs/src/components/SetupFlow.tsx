import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { Button, Group, Loader, Modal, Stack, Switch, Text, Title } from "@mantine/core";
import { Check, Copy, Share2 } from "lucide-react";
import { api } from "@infinidata/api";
import { stageWeeks, type PlayoffFormat, type PresetConfig } from "@playoffRules/format";
import { formatProblem } from "@playoffRules/validate";
import { getErrorMessage } from "@shared/errors";
import glass from "@shared/glass/GlassMatchupCard.module.css";
import { copyToClipboard } from "../lib/clipboard";
import { describeFormat } from "../lib/describeFormat";
import { platformFormat } from "../lib/platformFormat";
import { PLAYOFF_TYPES, resetsBySaving, savedKind, typeAllowed } from "../lib/rulesConfig";
import type { PlayoffRules, SeasonData } from "../lib/seasonData";
import {
  draftFormat,
  STEP_LABELS,
  stepsFor,
  withKind,
  type SetupDraft,
  type StepId,
} from "../lib/setupFlow";
import { FormatPreview } from "./FormatPreview";
import modal from "./GlassModal.module.css";
import {
  BracketWeeksInput,
  DoubleElimTeams,
  SeedBonusGrid,
  StandardTeams,
  StartWeekInput,
  TierBonus,
} from "./RulesFields";
import classes from "./SetupFlow.module.css";
import { TierPill } from "./TierPill";

const PLATFORM_LINE = "Your league's own playoffs, as set on its platform.";

// Waits between edits before saving the draft.
const DRAFT_SAVE_MS = 800;

// The league's playoff settings one step at a time: type, schedule, teams,
// bonuses, then Review - the only step that saves - then the invite link.
// The choices so far are kept as a server-side draft, so leaving halfway
// picks up where it stopped.
export function SetupFlow({
  seasonId,
  data,
  rules,
  saved,
  initial,
  onExit,
}: {
  seasonId: Id<"seasons">;
  data: SeasonData;
  rules: PlayoffRules;
  // The commissioner's saved rules - null for the platform's.
  saved: PlayoffFormat | null;
  initial: SetupDraft;
  // Cancel on the first step.
  onExit: () => void;
}) {
  const navigate = useNavigate();
  const saveDraft = useMutation(api.infiniyoffs.setup.saveSetupDraft);
  const [draft, setDraft] = useState(initial);
  // Once Review has saved, the draft is gone for good - don't write it back.
  const finished = useRef(false);

  useEffect(() => {
    if (finished.current || draft.step === "invite") return;
    const timer = setTimeout(() => void saveDraft({ seasonId, draft }), DRAFT_SAVE_MS);
    return () => clearTimeout(timer);
  }, [draft, seasonId, saveDraft]);

  const teamCount = data.teams.length;
  const steps = stepsFor(draft.kind);
  const index = steps.indexOf(draft.step);
  const format = draftFormat(draft, teamCount, saved);
  const go = (step: StepId) => setDraft({ ...draft, step });
  const next = () => {
    const step = steps[index + 1];
    if (step) go(step);
  };
  const back = () => {
    const step = steps[index - 1];
    if (step) go(step);
    else onExit();
  };
  const setConfig = (config: PresetConfig) => setDraft({ ...draft, config });

  // Problems that stop Next: the format's own checks, on the steps that
  // shape it.
  const problem =
    format && draft.step !== "type" && draft.step !== "invite"
      ? formatProblem(format, teamCount)
      : null;

  return (
    <Stack gap="md">
      <Stack gap={6}>
        <Text size="xs" c="dimmed">
          Step {index + 1} of {steps.length}
        </Text>
        <Title order={3}>{STEP_LABELS[draft.step]}</Title>
        <div className={classes.steps} aria-hidden>
          {steps.map((step, i) => (
            <span
              key={step}
              className={`${classes.stepSegment} ${
                i < index ? classes.stepDone : i === index ? classes.stepCurrent : ""
              }`}
            />
          ))}
        </div>
      </Stack>

      {draft.step === "type" && (
        <TypeStep
          data={data}
          current={savedKind(saved)}
          kind={draft.kind}
          onPick={(kind) => setDraft(withKind(draft, kind, data, saved))}
        />
      )}
      {draft.step === "schedule" && draft.config && (
        <ScheduleStep config={draft.config} onChange={setConfig} format={format} data={data} />
      )}
      {draft.step === "teams" && draft.config && (
        <TeamsStep config={draft.config} onChange={setConfig} format={format} data={data} />
      )}
      {draft.step === "bonus" && draft.config && (
        <BonusStep config={draft.config} onChange={setConfig} />
      )}
      {draft.step === "review" && (
        <ReviewStep
          seasonId={seasonId}
          rules={rules}
          format={format}
          problem={problem}
          steps={steps}
          onEdit={go}
          onBack={back}
          onSaved={() => {
            finished.current = true;
            go("invite");
          }}
        />
      )}
      {draft.step === "invite" && <InviteStep seasonId={seasonId} />}

      {problem && draft.step !== "review" && (
        <Text size="sm" c="red">
          {problem}
        </Text>
      )}

      {draft.step !== "review" && draft.step !== "invite" && (
        <Group justify="space-between">
          <Button variant="default" onClick={back}>
            {index === 0 ? "Cancel" : "Back"}
          </Button>
          <Group gap="xs">
            {draft.step === "bonus" && (
              <Button variant="subtle" onClick={next}>
                Skip
              </Button>
            )}
            <Button onClick={next} disabled={problem !== null}>
              Next
            </Button>
          </Group>
        </Group>
      )}
      {draft.step === "invite" && (
        <Group justify="flex-end">
          <Button
            onClick={() =>
              void navigate({ to: "/league/$leagueId", params: { leagueId: seasonId } })
            }
          >
            Done
          </Button>
        </Group>
      )}

      {draft.step !== "invite" && (
        <FormatPreview
          format={format ?? (draft.kind === "platform" ? platformFormat(data) : null)}
          teamCount={teamCount}
          unsaved={false}
        />
      )}
    </Stack>
  );
}

function TypeStep({
  data,
  current,
  kind,
  onPick,
}: {
  data: SeasonData;
  current: ReturnType<typeof savedKind>;
  kind: SetupDraft["kind"];
  onPick: (kind: SetupDraft["kind"]) => void;
}) {
  const types = PLAYOFF_TYPES.filter((type) => type.kind !== "custom" || current === "custom");
  return (
    <Stack gap="sm" role="radiogroup" aria-label="Playoff type">
      {types.map((type) => {
        const allowed = typeAllowed(type.kind, data.teams.length, current);
        const selected = type.kind === kind;
        return (
          <button
            key={type.kind}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={!allowed}
            className={`${glass.card} ${classes.option} ${selected ? classes.selected : ""}`}
            onClick={() => onPick(type.kind)}
          >
            <Group justify="space-between" wrap="nowrap" px={4}>
              <Stack gap={2}>
                <Text fw={600}>{type.label(data)}</Text>
                <Text size="sm" c="dimmed">
                  {type.about(data)}
                </Text>
              </Stack>
              {selected && <Check size={18} />}
            </Group>
          </button>
        );
      })}
    </Stack>
  );
}

// "Regular season weeks 1-11 · Playoffs weeks 12-17".
function Timeline({ format }: { format: PlayoffFormat }) {
  const end = format.regularSeasonEndWeek;
  const last = Math.max(end, ...format.stages.flatMap(stageWeeks));
  return (
    <Text size="sm" c="dimmed">
      Regular season weeks 1-{end} · Playoffs weeks {end + 1}-{last}
    </Text>
  );
}

function ScheduleStep({
  config,
  onChange,
  format,
  data,
}: {
  config: PresetConfig;
  onChange: (config: PresetConfig) => void;
  format: PlayoffFormat | null;
  data: SeasonData;
}) {
  const startWeek = config.regularSeasonEndWeek + 1;
  const started = data.currentWeek >= startWeek;
  return (
    <div className={glass.card}>
      <Stack gap="sm" p={4}>
        {config.kind === "doubleElim" ? (
          <Group grow align="flex-start">
            <StartWeekInput config={config} onChange={onChange} />
            <BracketWeeksInput
              config={config}
              onChange={(patch) => onChange({ ...config, ...patch })}
            />
          </Group>
        ) : (
          <StartWeekInput config={config} onChange={onChange} />
        )}
        {config.kind === "standard" && (
          <Switch
            label="Two-week rounds"
            checked={config.weeksPerRound === 2}
            onChange={(event) =>
              onChange({ ...config, weeksPerRound: event.currentTarget.checked ? 2 : 1 })
            }
          />
        )}
        {format && <Timeline format={format} />}
        {started && (
          <Text size="sm" c="yellow">
            Week {startWeek} has already started.
          </Text>
        )}
      </Stack>
    </div>
  );
}

function TeamsStep({
  config,
  onChange,
  format,
  data,
}: {
  config: PresetConfig;
  onChange: (config: PresetConfig) => void;
  format: PlayoffFormat | null;
  data: SeasonData;
}) {
  const teamCount = data.teams.length;
  return (
    <div className={glass.card}>
      <Stack gap="sm" p={4}>
        {config.kind === "standard" && (
          <StandardTeams
            config={config}
            onChange={(patch) => onChange({ ...config, ...patch })}
            teamCount={teamCount}
          />
        )}
        {config.kind === "doubleElim" && (
          <DoubleElimTeams
            config={config}
            onChange={(patch) => onChange({ ...config, ...patch })}
            teamCount={teamCount}
          />
        )}
        {config.kind === "worldCup" && format && (
          <>
            <Text size="sm" c="dimmed">
              Tiers by final seed, seeded by record:
            </Text>
            {format.tiers.map((tier) => (
              <Group key={tier.name} gap="xs">
                <TierPill format={format} tier={tier.name} />
                <Text size="sm">
                  Seeds {tier.firstSeed}-{tier.lastSeed}
                </Text>
              </Group>
            ))}
          </>
        )}
      </Stack>
    </div>
  );
}

function BonusStep({
  config,
  onChange,
}: {
  config: PresetConfig;
  onChange: (config: PresetConfig) => void;
}) {
  return (
    <div className={glass.card}>
      <Stack gap="sm" p={4}>
        {config.kind === "standard" && (
          <>
            <Text size="sm" c="dimmed">
              Points added to a seed's score each round.
            </Text>
            <SeedBonusGrid
              config={config}
              onChange={(patch) => onChange({ ...config, ...patch })}
            />
          </>
        )}
        {config.kind === "worldCup" && (
          <>
            <Text size="sm" c="dimmed">
              Points added to each tier's score every group week.
            </Text>
            <TierBonus config={config} onChange={onChange} />
          </>
        )}
      </Stack>
    </div>
  );
}

function ReviewStep({
  seasonId,
  rules,
  format,
  problem,
  steps,
  onEdit,
  onBack,
  onSaved,
}: {
  seasonId: Id<"seasons">;
  rules: PlayoffRules;
  format: PlayoffFormat | null;
  problem: string | null;
  steps: StepId[];
  onEdit: (step: StepId) => void;
  onBack: () => void;
  onSaved: () => void;
}) {
  const finishSetup = useMutation(api.infiniyoffs.setup.finishSetup);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const resets = resetsBySaving(rules, format);

  const save = async () => {
    setConfirming(false);
    setSaving(true);
    setError(null);
    try {
      await finishSetup({ seasonId, format });
      onSaved();
    } catch (err) {
      setError(getErrorMessage(err, "Failed to save the rules."));
      setSaving(false);
    }
  };

  const editable = steps.filter((step) => step !== "review" && step !== "invite");
  return (
    <>
      <div className={glass.card}>
        <Stack gap={6} p={4}>
          {(format ? describeFormat(format) : [PLATFORM_LINE]).map((line) => (
            <Text key={line} size="sm">
              {line}
            </Text>
          ))}
          <Group gap={4} mt={4}>
            {editable.map((step) => (
              <Button key={step} size="compact-xs" variant="subtle" onClick={() => onEdit(step)}>
                Edit {STEP_LABELS[step].toLowerCase()}
              </Button>
            ))}
          </Group>
        </Stack>
      </div>
      {(problem ?? error) && (
        <Text size="sm" c="red">
          {problem ?? error}
        </Text>
      )}
      <Group justify="space-between">
        <Button variant="default" onClick={onBack}>
          Back
        </Button>
        <Button
          loading={saving}
          disabled={problem !== null}
          onClick={() => (resets ? setConfirming(true) : void save())}
        >
          Save rules
        </Button>
      </Group>
      <Modal
        opened={confirming}
        onClose={() => setConfirming(false)}
        title="Save and reset?"
        centered
        classNames={modal}
      >
        <Stack gap="md">
          <Text size="sm">This change resets {resets}.</Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button color="red" onClick={() => void save()}>
              Save and reset
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

// The league link, made on arrival if there isn't one, to copy or share.
function InviteStep({ seasonId }: { seasonId: Id<"seasons"> }) {
  const token = useQuery(api.infiniyoffs.members.getLeagueInvite, { seasonId });
  const createInvite = useMutation(api.infiniyoffs.members.createLeagueInvite);
  const [copied, setCopied] = useState(false);
  const creating = useRef(false);

  useEffect(() => {
    if (token === null && !creating.current) {
      creating.current = true;
      void createInvite({ seasonId });
    }
  }, [token, seasonId, createInvite]);

  const url = token ? `${window.location.origin}/invite/${token}` : null;
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const copy = async () => {
    if (url && (await copyToClipboard(url))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className={glass.card}>
      <Stack gap="sm" p={4}>
        <Text size="sm">Rules saved. Send your league this link to join.</Text>
        <Text size="sm" c="dimmed">
          Each person picks their team or just watches.
        </Text>
        {url ? (
          <Group gap="xs" grow>
            <Button
              leftSection={copied ? <Check size={16} /> : <Copy size={16} />}
              onClick={() => void copy()}
            >
              {copied ? "Copied" : "Copy link"}
            </Button>
            {canShare && (
              <Button
                variant="default"
                leftSection={<Share2 size={16} />}
                onClick={() => void navigator.share({ url }).catch(() => {})}
              >
                Share
              </Button>
            )}
          </Group>
        ) : (
          <Loader size="sm" />
        )}
      </Stack>
    </div>
  );
}
