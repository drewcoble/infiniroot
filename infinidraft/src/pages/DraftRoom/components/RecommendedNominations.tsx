import {
  Anchor,
  Badge,
  Button,
  Card,
  Group,
  SegmentedControl,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { ArrowRightLeft, Flame, Percent } from "lucide-react";
import { useState } from "react";
import { POSITION_COLORS } from "@shared/positionColors";
import type { NominationStrategyResults } from "../../../lib/nominationStrategies";
import type { StandardValueRow } from "../../../lib/standardValues";
import { StandardValueLabel } from "../../../components/StandardValueLabel";

interface RecommendedNominationsProps {
  results: NominationStrategyResults;
  hasActiveNomination: boolean;
  onNominate: (fpid: number) => void;
  onSelectPlayer: (fpid: number) => void;
  standardValueByFpid: Map<number, StandardValueRow>;
}

type Strategy = "highDemand" | "discount" | "dump";

const STRATEGY_DATA: {
  value: Strategy;
  label: React.ReactNode;
  emptyText: string;
}[] = [
  {
    value: "highDemand",
    label: (
      <Group gap={4} wrap="nowrap">
        <Flame size={14} />
        <span>High Demand</span>
      </Group>
    ),
    emptyText: "No high-demand nominations right now.",
  },
  {
    value: "discount",
    label: (
      <Group gap={4} wrap="nowrap">
        <Percent size={14} />
        <span>Great Time to Act</span>
      </Group>
    ),
    emptyText: "No discount nominations right now.",
  },
  {
    value: "dump",
    label: (
      <Group gap={4} wrap="nowrap">
        <ArrowRightLeft size={14} />
        <span>Don't Need</span>
      </Group>
    ),
    emptyText: "Nothing to dump yet — you still need every position.",
  },
];

// One glance-and-tap panel: pick a strategy, read the one-line "why" under
// each suggested player, tap Nominate. Mirrors ShortlistTable/
// RecentPicksTable's title + empty-state + Table.ScrollContainer
// convention so it reads as part of the same family of Draft-tab panels.
export function RecommendedNominations({
  results,
  hasActiveNomination,
  onNominate,
  onSelectPlayer,
  standardValueByFpid,
}: RecommendedNominationsProps) {
  const [strategy, setStrategy] = useState<Strategy>("highDemand");
  const active = STRATEGY_DATA.find((s) => s.value === strategy)!;
  const rows = results[strategy];

  return (
    <Card withBorder padding="md">
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap" gap="xs">
          <Text size="sm" fw={500}>
            Recommended nominations
          </Text>
          <SegmentedControl
            size="xs"
            value={strategy}
            onChange={(value) => setStrategy(value as Strategy)}
            data={STRATEGY_DATA.map(({ value, label }) => ({ value, label }))}
          />
        </Group>
        {rows.length === 0 ? (
          <Text size="sm" c="dimmed">
            {active.emptyText}
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={420}>
            <Table highlightOnHover verticalSpacing={4}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Player</Table.Th>
                  <Table.Th>Why</Table.Th>
                  <Table.Th>$</Table.Th>
                  <Table.Th>vs. market</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map(({ row, reason }) => (
                  <Table.Tr key={row.fpid}>
                    <Table.Td>
                      <Group gap={6} wrap="wrap">
                        <Anchor
                          component="button"
                          type="button"
                          onClick={() => onSelectPlayer(row.fpid)}
                        >
                          {row.name}
                        </Anchor>
                        <Badge
                          size="sm"
                          variant="light"
                          color={POSITION_COLORS[row.position]}
                        >
                          {row.position}
                        </Badge>
                        <Text size="xs" c="dimmed">
                          {row.team ?? "—"}
                        </Text>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {reason}
                      </Text>
                    </Table.Td>
                    <Table.Td>${Math.round(row.dollarValue)}</Table.Td>
                    <Table.Td>
                      <StandardValueLabel
                        draftValue={row.dollarValue}
                        standardValue={standardValueByFpid.get(row.fpid)}
                        showLabel={false}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Button
                        size="compact-xs"
                        disabled={hasActiveNomination}
                        onClick={() => onNominate(row.fpid)}
                      >
                        Nominate
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        {hasActiveNomination && (
          <Text size="xs" c="dimmed">
            Resolve the current nomination first.
          </Text>
        )}
      </Stack>
    </Card>
  );
}
