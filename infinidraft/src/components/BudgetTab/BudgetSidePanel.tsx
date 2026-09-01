import { type ReactNode } from "react";
import {
  Card,
  Badge,
  Button,
  Collapse,
  Group,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { OverspendBehavior } from "../../types";
import { BUDGET_PRESETS, type BudgetPreset } from "../../lib/budgetPresets";
import { OVERSPEND_OPTIONS } from "../../constants/budget";

interface BudgetSidePanelProps {
  // "Starter Budgets" only makes sense pre-draft (mode: "predraft") -
  // applying a preset mid-draft (mode: "live") would blow away whatever
  // in-draft reallocations the live plan already reflects, so BudgetTab.tsx
  // only sets this true in predraft mode.
  showPresets: boolean;
  // "Superflex heavy" is meaningless without a SUPERFLEX slot to spend on -
  // dropped from the list entirely for leagues without one.
  hasSuperflex: boolean;
  // Which preset (if any) the current amounts still exactly match - null
  // the instant the user edits a slot away from it. See BudgetTab.tsx's
  // activePreset for how that's derived.
  activePreset: BudgetPreset | null;
  onApplyPreset: (preset: BudgetPreset) => void;
  perStarter: number;
  perBench: number;
  topThreePct: number;
  everySlotHasADollar: boolean;
  overspendBehavior: OverspendBehavior;
  onOverspendChange: (behavior: OverspendBehavior) => void;
}

// "Starter Budgets" and "Auto Adjustments" collapse (default closed) so
// they don't eat vertical space once a preset/overspend choice is already
// made - "Sanity checks" stays always-expanded (it's read-only feedback,
// not a one-time setup choice you'd want to tuck away).
function CollapsibleCard({
  title,
  titleExtra,
  children,
}: {
  title: string;
  // A brief "here's what's currently chosen" badge next to the title, so
  // the choice is still visible at a glance while collapsed - e.g. Auto
  // Adjustments' On: Bench/On: All/Off summary below.
  titleExtra?: ReactNode;
  children: ReactNode;
}) {
  const [opened, { toggle }] = useDisclosure(false);
  return (
    <Card withBorder padding="md">
      <Stack gap={8}>
        <UnstyledButton onClick={toggle} aria-expanded={opened}>
          <Group justify="space-between" wrap="nowrap">
            <Group gap={6} wrap="nowrap">
              <Text size="sm" fw={500} tt="uppercase" c="dimmed">
                {title}
              </Text>
              {titleExtra}
            </Group>
            {opened ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </Group>
        </UnstyledButton>
        <Collapse in={opened}>
          <Stack gap={8}>{children}</Stack>
        </Collapse>
      </Stack>
    </Card>
  );
}

// Super-brief summary of the current overspend/auto-adjust choice, shown
// next to the "Auto Adjustments" title so it's legible even while the card
// is collapsed - OVERSPEND_OPTIONS' own labels/captions are full sentences,
// too long for that spot.
function overspendSummary(value: OverspendBehavior): string {
  if (value === "bench") return "On: Bench";
  if (value === "spread") return "On: All";
  return "Off";
}

export function BudgetSidePanel({
  showPresets,
  hasSuperflex,
  activePreset,
  onApplyPreset,
  perStarter,
  perBench,
  topThreePct,
  everySlotHasADollar,
  overspendBehavior,
  onOverspendChange,
}: BudgetSidePanelProps) {
  const selectedOverspend = OVERSPEND_OPTIONS.find(
    (option) => option.value === overspendBehavior,
  );
  const presets = BUDGET_PRESETS.filter(
    (preset) => hasSuperflex || preset.value !== "superflexHeavy",
  );
  // Looked up from the full list, not `presets` - activePreset can still
  // be "superflexHeavy" from before a SUPERFLEX slot was removed, even
  // though that button itself is no longer shown.
  const selectedPreset = BUDGET_PRESETS.find(
    (preset) => preset.value === activePreset,
  );

  return (
    <Stack gap="md">
      {showPresets && (
        <CollapsibleCard title="Starter Budgets">
          {presets.map((preset) => (
            <Button
              key={preset.value}
              variant={preset.value === activePreset ? "filled" : "default"}
              fullWidth
              onClick={() => onApplyPreset(preset.value)}
            >
              {preset.label}
            </Button>
          ))}
          <Text size="xs" c="dimmed">
            {selectedPreset
              ? selectedPreset.caption
              : "A preset lands as numbers you then tune."}
          </Text>
        </CollapsibleCard>
      )}

      <CollapsibleCard
        title="Auto Adjustments"
        titleExtra={
          <Badge variant="light" color="gray" size="sm">
            {overspendSummary(overspendBehavior)}
          </Badge>
        }
      >
        {OVERSPEND_OPTIONS.map((option) => (
          <Button
            key={option.value}
            variant={option.value === overspendBehavior ? "filled" : "default"}
            fullWidth
            onClick={() => onOverspendChange(option.value)}
          >
            {option.label}
          </Button>
        ))}
        {selectedOverspend && (
          <Text size="xs" c="dimmed">
            {selectedOverspend.caption}
          </Text>
        )}
      </CollapsibleCard>

      <Card withBorder padding="md">
        <Stack gap={6}>
          <Text size="sm" fw={500} tt="uppercase" c="dimmed">
            Sanity checks
          </Text>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              $ per starter
            </Text>
            <Text size="sm">${perStarter.toFixed(1)}</Text>
          </Group>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              $ per bench player
            </Text>
            <Text size="sm">${perBench.toFixed(1)}</Text>
          </Group>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              Top three slots
            </Text>
            <Text size="sm">{topThreePct}% of cap</Text>
          </Group>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              $1 available for every slot
            </Text>
            <Text size="sm">{everySlotHasADollar ? "yes" : "no"}</Text>
          </Group>
        </Stack>
      </Card>
    </Stack>
  );
}
