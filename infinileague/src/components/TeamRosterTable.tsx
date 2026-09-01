import { Badge, Group, Table, Text } from "@mantine/core";
import { RookieBadge } from "@shared/RookieBadge";
import { injuryColor } from "@shared/injuryColor";
import { positionColorOrDefault } from "@shared/positionColors";
import type { TeamRosterRow } from "../types/season";

interface TeamRosterTableProps {
  rows: TeamRosterRow[];
}

function formatPoints(points: number | undefined): string {
  return points === undefined ? "—" : points.toFixed(1);
}

// Same table shape as infinidraft's own roster table (DraftRoom/components/
// SlotTable.tsx, the "My Team" tab) - Table.ScrollContainer + a tighter
// verticalSpacing={4} instead of Mantine's default spacing, and the slot
// badge sharing the Player cell instead of its own unlabeled leading
// column. Pos stays its own separate labeled column here (unlike
// SlotTable, which has none) since a bench/IR/taxi slot doesn't imply a
// position the way a starting slot does - same miw={70} convention
// PlayersTable.tsx's Pos column uses. Rows arrive pre-sorted from the
// backend in infinidraft's own canonical slot order (QB, SUPERFLEX, RB, WR,
// FLEX, TE, DST, K, BENCH, IR, TAXI - see convex/season/teamRoster.ts's
// SLOT_ORDER_RANK), rendered as-is. A row with no fpid is an unfilled slot
// (an open bench/taxi spot the league is configured for) - same "badge +
// dimmed em dash" treatment SlotTable uses for an empty draft slot.
export function TeamRosterTable({ rows }: TeamRosterTableProps) {
  return (
    <Table.ScrollContainer minWidth={520}>
      <Table highlightOnHover verticalSpacing={4}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Player</Table.Th>
            <Table.Th miw={70}>Pos</Table.Th>
            <Table.Th>Team</Table.Th>
            <Table.Th>Bye</Table.Th>
            <Table.Th>Proj</Table.Th>
            <Table.Th>Actual</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((row, index) => (
            <Table.Tr key={row.fpid ?? `empty-${row.slot}-${index}`}>
              <Table.Td miw={220}>
                <Group gap={6} wrap="nowrap" align="center">
                  {row.slot !== undefined && (
                    <Badge size="sm" variant="light" color={positionColorOrDefault(row.slot)}>
                      {row.slot === "BENCH" ? "Bench" : row.slot === "TAXI" ? "Taxi" : row.slot}
                    </Badge>
                  )}
                  {row.fpid !== undefined ? (
                    <Group gap={6} wrap="nowrap">
                      <Text span size="sm">
                        {row.name}
                      </Text>
                      {row.isRookie && <RookieBadge />}
                      {row.injury && (
                        <Badge color={injuryColor(row.injury.status)} size="sm" variant="light">
                          {row.injury.statusShort}
                        </Badge>
                      )}
                    </Group>
                  ) : (
                    <Text size="sm" c="dimmed">
                      —
                    </Text>
                  )}
                </Group>
              </Table.Td>
              <Table.Td miw={70}>
                {row.position && (
                  <Badge size="sm" color={positionColorOrDefault(row.position)} variant="light">
                    {row.position}
                  </Badge>
                )}
              </Table.Td>
              <Table.Td>{row.team ?? "—"}</Table.Td>
              <Table.Td>{row.byeWeek ?? "—"}</Table.Td>
              <Table.Td>{formatPoints(row.projectedPoints)}</Table.Td>
              <Table.Td>{formatPoints(row.actualPoints)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
