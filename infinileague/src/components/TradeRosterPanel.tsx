import { Badge, Checkbox, Group, Stack, Table, Text } from "@mantine/core";
import { positionColorOrDefault } from "@shared/positionColors";
import type { RosVorRow, TeamRosterRow } from "../types/season";
import type { TradeValueMetric } from "../lib/tradeAnalyzer";

interface TradeRosterPanelProps {
  rows: TeamRosterRow[];
  vorByFpid: Map<number, RosVorRow>;
  metric: TradeValueMetric;
  selected: Set<number>;
  onToggle: (fpid: number) => void;
}

// One team's checkbox-selectable roster for the Trade tab - same row shape
// as TeamRosterTable (slot badge + name/position/team), swapping Proj/
// Actual for this player's own rosVOR/actualVOR (the trade math's actual
// currency, see src/lib/tradeAnalyzer.ts) and a leading checkbox for
// picking which players move. Unfilled slots and IR/TAXI players aren't
// tradeable pieces, so they're left out entirely rather than rendered
// disabled - same eligibility buildTradePool uses.
export function TradeRosterPanel({
  rows,
  vorByFpid,
  metric,
  selected,
  onToggle,
}: TradeRosterPanelProps) {
  const tradeableRows = rows.filter(
    (row) => row.fpid !== undefined && row.slot !== "IR" && row.slot !== "TAXI",
  );

  return (
    <Table highlightOnHover verticalSpacing={4} layout="fixed" w="100%" withRowBorders={false}>
      <Table.Thead>
        <Table.Tr>
          <Table.Th w={32} />
          <Table.Th>Player</Table.Th>
          <Table.Th w={64}>{metric === "rosVor" ? "ROS VOR" : "VOR"}</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {tradeableRows.map((row) => {
          const fpid = row.fpid as number;
          const value = vorByFpid.get(fpid)?.[metric] ?? 0;
          const isSelected = selected.has(fpid);
          return (
            <Table.Tr key={fpid} onClick={() => onToggle(fpid)} style={{ cursor: "pointer" }}>
              <Table.Td onClick={(event) => event.stopPropagation()}>
                <Checkbox checked={isSelected} onChange={() => onToggle(fpid)} />
              </Table.Td>
              <Table.Td>
                <Group gap={6} wrap="nowrap" align="center">
                  {row.slot !== undefined && (
                    <Badge size="sm" variant="light" color={positionColorOrDefault(row.slot)}>
                      {row.slot === "BENCH"
                        ? "BN"
                        : row.slot === "SUPERFLEX"
                          ? "SFLEX"
                          : row.slot}
                    </Badge>
                  )}
                  <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                    <Text span size="sm" truncate>
                      {row.name}
                    </Text>
                    <Text size="xs" c="dimmed" truncate>
                      {row.position && (
                        <>
                          <Text span c={positionColorOrDefault(row.position)} inherit>
                            {row.position}
                          </Text>
                          {" - "}
                        </>
                      )}
                      {row.team ?? "—"}
                    </Text>
                  </Stack>
                </Group>
              </Table.Td>
              <Table.Td>{value.toFixed(1)}</Table.Td>
            </Table.Tr>
          );
        })}
      </Table.Tbody>
    </Table>
  );
}
