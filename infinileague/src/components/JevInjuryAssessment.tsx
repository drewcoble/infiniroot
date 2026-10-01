import { Group, Stack, Text } from "@mantine/core";
import { Sparkles } from "lucide-react";
import type { Doc } from "@infinidata/dataModel";

const TIMELINE_LABELS: Record<string, string> = {
  none: "No games missed",
  this_week: "Misses ≤ 1 game",
  few_weeks: "2–4 weeks",
  extended: "5+ weeks",
  season: "Season-ending",
};

const pct = (value: number) => `${Math.round(value * 100)}%`;

// Read-only view of the assessment the injury cron stores on the row (see
// convex/infinileague/injuryAssessment.ts). Prob. of playing itself is
// already shown by the shared InjuryReport from probabilityOfPlaying.
export function JevInjuryAssessment({ injury }: { injury: Doc<"injuries"> }) {
  const assessment = injury.assessment;

  if (!assessment) {
    return (
      <Text size="xs" c="dimmed" mt="xs">
        Jev assessment pending - runs on the next injury refresh.
      </Text>
    );
  }

  const { availability, limitation, timeline, aggravationRisk, ruleOverride } = assessment;
  // limitation assumes the player plays, so it's noise when they won't.
  const willNotPlay = injury.probabilityOfPlaying === 0;

  return (
    <Stack gap={4} mt="xs" pt="xs" style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
      <Group gap={6}>
        <Sparkles size={14} />
        <Text size="xs" fw={600}>
          Jev
        </Text>
        <Text size="xs" c="dimmed">
          {new Date(assessment.assessedAt).toLocaleString()}
          {ruleOverride ? ` · prob. set by rule: ${ruleOverride}` : ""}
        </Text>
      </Group>
      {availability && (
        <Group gap={6}>
          <Text size="xs" fw={600} c="dimmed">
            Availability:
          </Text>
          <Text size="xs">
            {availability.label} ({availability.score.toFixed(2)} / 4)
          </Text>
          <Text size="xs" c="dimmed">
            conf {pct(availability.confidence)}
          </Text>
        </Group>
      )}
      {limitation && !willNotPlay && (
        <Group gap={6}>
          <Text size="xs" fw={600} c="dimmed">
            If active:
          </Text>
          <Text size="xs">
            {limitation.label} ({limitation.score.toFixed(2)} / 3)
          </Text>
          <Text size="xs" c="dimmed">
            conf {pct(limitation.confidence)}
          </Text>
        </Group>
      )}
      {timeline && (
        <Group gap={6}>
          <Text size="xs" fw={600} c="dimmed">
            Timeline:
          </Text>
          <Text size="xs">{TIMELINE_LABELS[timeline.choice] ?? timeline.choice}</Text>
          <Text size="xs" c="dimmed">
            p {pct(timeline.probability)} · conf {pct(timeline.confidence)}
          </Text>
        </Group>
      )}
      {aggravationRisk !== undefined && (
        <Group gap={6}>
          <Text size="xs" fw={600} c="dimmed">
            Re-aggravation-prone:
          </Text>
          <Text size="xs">{pct(aggravationRisk)}</Text>
        </Group>
      )}
    </Stack>
  );
}
