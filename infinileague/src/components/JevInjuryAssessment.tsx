import { useState } from "react";
import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Badge, Button, Code, Collapse, Group, Stack, Text } from "@mantine/core";
import { Sparkles } from "lucide-react";
import { api } from "@infinidata/api";
import type { Id } from "@infinidata/dataModel";

type JevResult = FunctionReturnType<typeof api.infinileague.injuryAssessment.assessInjury>;

const TIMELINE_LABELS: Record<string, string> = {
  none: "No games missed",
  this_week: "Misses ≤ 1 game",
  few_weeks: "2–4 weeks",
  extended: "5+ weeks",
  season: "Season-ending",
};

const ACTION_LABELS: Record<string, string> = {
  start: "Start",
  start_risky: "Start (risky)",
  bench: "Bench",
  stash_ir: "Stash on IR",
  drop: "Drop",
};

const pct = (value: number) => `${Math.round(value * 100)}%`;

// POC: live call to Jev (see convex/infinileague/injuryAssessment.ts) on
// click, nothing cached - every "Ask Jev" is a fresh request.
export function JevInjuryAssessment({ injuryId }: { injuryId: Id<"injuries"> }) {
  const assessInjury = useAction(api.infinileague.injuryAssessment.assessInjury);
  const [result, setResult] = useState<JevResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      setResult(await assessInjury({ injuryId }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const { availability, limitation, timeline, fantasy_action, aggravation_risk } = result?.answers ?? {};
  // limitation assumes the player plays, so it's noise when they won't.
  const willNotPlay = availability?.type === "score" && Math.round(availability.score) === 0;

  return (
    <Stack gap={6} mt="xs" pt="xs" style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
      <Group gap="xs" justify="space-between">
        <Group gap={6}>
          <Sparkles size={14} />
          <Text size="xs" fw={600}>
            Jev
          </Text>
          {result && (
            <Text size="xs" c="dimmed">
              {result.model} · {result.usage.input_tokens + result.usage.output_tokens} tokens
            </Text>
          )}
        </Group>
        <Group gap={4}>
          {result && (
            <Button size="compact-xs" variant="subtle" color="gray" onClick={() => setShowRaw((s) => !s)}>
              {showRaw ? "Hide raw" : "Raw"}
            </Button>
          )}
          <Button size="compact-xs" variant="light" loading={loading} onClick={run}>
            {result ? "Re-run" : "Ask Jev"}
          </Button>
        </Group>
      </Group>

      {error && (
        <Text size="xs" c="red">
          {error}
        </Text>
      )}

      {result && (
        <Stack gap={4}>
          {availability?.type === "score" && (
            <Group gap={6}>
              <Text size="xs" fw={600} c="dimmed">
                Availability:
              </Text>
              <Text size="xs">
                {availability.legend[String(Math.round(availability.score))]} ({availability.score.toFixed(2)} / 4)
              </Text>
              <Text size="xs" c="dimmed">
                conf {pct(availability.confidence)}
              </Text>
            </Group>
          )}
          {limitation?.type === "score" && !willNotPlay && (
            <Group gap={6}>
              <Text size="xs" fw={600} c="dimmed">
                If active:
              </Text>
              <Text size="xs">
                {limitation.legend[String(Math.round(limitation.score))]} ({limitation.score.toFixed(2)} / 3)
              </Text>
              <Text size="xs" c="dimmed">
                conf {pct(limitation.confidence)}
              </Text>
            </Group>
          )}
          {timeline?.type === "choice" && (
            <Group gap={6}>
              <Text size="xs" fw={600} c="dimmed">
                Timeline:
              </Text>
              <Text size="xs">{TIMELINE_LABELS[timeline.choice] ?? timeline.choice}</Text>
              <Text size="xs" c="dimmed">
                p {pct(timeline.probabilities[timeline.choice] ?? 0)} · conf {pct(timeline.confidence)}
              </Text>
            </Group>
          )}
          {fantasy_action?.type === "choice" && (
            <Group gap={6}>
              <Text size="xs" fw={600} c="dimmed">
                Action:
              </Text>
              <Badge size="xs" variant="light">
                {ACTION_LABELS[fantasy_action.choice] ?? fantasy_action.choice}
              </Badge>
              <Text size="xs" c="dimmed">
                p {pct(fantasy_action.probabilities[fantasy_action.choice] ?? 0)} · conf{" "}
                {pct(fantasy_action.confidence)}
              </Text>
            </Group>
          )}
          {aggravation_risk?.type === "noul" && (
            <Group gap={6}>
              <Text size="xs" fw={600} c="dimmed">
                Re-aggravation-prone:
              </Text>
              <Text size="xs">{pct(aggravation_risk.noul)}</Text>
            </Group>
          )}
          <Collapse in={showRaw}>
            <Code block fz={10}>
              {JSON.stringify(result, null, 2)}
            </Code>
          </Collapse>
        </Stack>
      )}
    </Stack>
  );
}
