import { Group, Stack, Text } from "@mantine/core";
import { Sparkles } from "lucide-react";
import type { Doc } from "@infinidata/dataModel";
import { STATUS } from "./charts/chartTheme";
import { SegmentGauge } from "./charts/SegmentGauge";
import { formatRelativeTime } from "../lib/relativeTime";

// Every gauge runs best (left) to worst (right), and more fill always
// means worse news, so the four read the same way side by side.
const AVAILABILITY_STEPS = ["Full go", "Likely", "Game-time call", "Unlikely", "Out"];
const LIMITATION_STEPS = ["No impact", "Slightly limited", "Limited", "Decoy role"];
const TIMELINE_STEPS = ["No games", "≤ 1 game", "2–4 weeks", "5+ weeks", "Season"];
const TIMELINE_LEVEL: Record<string, number> = {
  none: 0,
  this_week: 1,
  few_weeks: 2,
  extended: 3,
  season: 4,
};
const RISK_STEPS = ["Low", "Moderate", "High"];

// Severity color from how far along the gauge the level sits.
function severityColor(level: number, stepCount: number): string {
  const share = stepCount > 1 ? level / (stepCount - 1) : 0;
  if (share === 0) return STATUS.good;
  if (share < 0.5) return STATUS.warning;
  if (share < 0.75) return STATUS.serious;
  return STATUS.critical;
}

// The injury outlook the injury cron stores on the row (see convex/
// infinileague/injuryAssessment.ts), as step gauges rather than raw model
// scores. Availability and limitation are stored high = healthy (0-4 and
// 0-3), so they're flipped onto the gauges' worse-is-further scale.
// Prob. of playing itself is already shown by the shared InjuryReport.
export function InjuryOutlook({ injury }: { injury: Doc<"injuries"> }) {
  const assessment = injury.assessment;

  if (!assessment) {
    return (
      <Text size="xs" c="dimmed" mt="xs">
        Outlook coming with the next injury update.
      </Text>
    );
  }

  const { availability, limitation, timeline, aggravationRisk, ruleOverride } = assessment;
  // Limitation assumes the player plays, so it's noise when they won't.
  const willNotPlay = injury.probabilityOfPlaying === 0;

  // An IR/Out-type designation means he can't play, whatever the read of
  // the report says - pinned to Out, and said why.
  const availabilityLevel = ruleOverride
    ? AVAILABILITY_STEPS.length - 1
    : availability
      ? AVAILABILITY_STEPS.length - 1 - Math.round(availability.score)
      : undefined;
  const limitationLevel = limitation
    ? LIMITATION_STEPS.length - 1 - Math.round(limitation.score)
    : undefined;
  const timelineLevel = timeline ? TIMELINE_LEVEL[timeline.choice] : undefined;
  const riskLevel =
    aggravationRisk === undefined
      ? undefined
      : aggravationRisk < 0.34
        ? 0
        : aggravationRisk < 0.67
          ? 1
          : 2;

  return (
    <Stack
      gap="sm"
      mt="xs"
      pt="xs"
      style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
    >
      <Group gap={6}>
        <Sparkles size={14} />
        <Text size="xs" fw={600}>
          Outlook
        </Text>
        <Text size="xs" c="dimmed">
          Updated {formatRelativeTime(assessment.assessedAt)}
        </Text>
      </Group>
      {availabilityLevel !== undefined && (
        <SegmentGauge
          title="Next game"
          steps={AVAILABILITY_STEPS}
          level={availabilityLevel}
          color={severityColor(availabilityLevel, AVAILABILITY_STEPS.length)}
          confidence={availability?.confidence}
          note={ruleOverride ? "per injury status" : undefined}
        />
      )}
      {limitationLevel !== undefined && !willNotPlay && (
        <SegmentGauge
          title="If he plays"
          steps={LIMITATION_STEPS}
          level={limitationLevel}
          color={severityColor(limitationLevel, LIMITATION_STEPS.length)}
          confidence={limitation?.confidence}
        />
      )}
      {timelineLevel !== undefined && (
        <SegmentGauge
          title="Time missed"
          steps={TIMELINE_STEPS}
          level={timelineLevel}
          color={severityColor(timelineLevel, TIMELINE_STEPS.length)}
          confidence={timeline?.confidence}
        />
      )}
      {riskLevel !== undefined && (
        <SegmentGauge
          title="Re-injury risk"
          steps={RISK_STEPS}
          level={riskLevel}
          color={severityColor(riskLevel, RISK_STEPS.length)}
        />
      )}
    </Stack>
  );
}
