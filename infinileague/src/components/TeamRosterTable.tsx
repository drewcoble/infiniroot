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

// Rows arrive pre-sorted from the backend in infinidraft's own canonical
// slot order (QB, SUPERFLEX, RB, WR, FLEX, TE, DST, K, BENCH - see
// convex/season/teamRoster.ts's SLOT_ORDER_RANK) - rendered as-is. Slot
// leads (empty header, just the colored badge - which lineup spot a player
// occupies is the primary grouping signal here) with Pos following it -
// still colorized, just relocated from the lead spot it held before.
export function TeamRosterTable({ rows }: TeamRosterTableProps) {
  return (
    <Table striped highlightOnHover>
      <Table.Thead>
        <Table.Tr>
          <Table.Th />
          <Table.Th>Player</Table.Th>
          <Table.Th>Team</Table.Th>
          <Table.Th>Bye</Table.Th>
          <Table.Th>Pos</Table.Th>
          <Table.Th>Proj</Table.Th>
          <Table.Th>Actual</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((row) => (
          <Table.Tr key={row.fpid}>
            <Table.Td>
              {row.slot !== undefined && (
                <Badge size="sm" color={positionColorOrDefault(row.slot)} variant="light">
                  {row.slot === "BENCH" ? "Bench" : row.slot}
                </Badge>
              )}
            </Table.Td>
            <Table.Td>
              <Group gap={6} wrap="nowrap">
                <Text span>{row.name}</Text>
                {row.isRookie && <RookieBadge />}
                {row.injury && (
                  <Badge color={injuryColor(row.injury.status)} size="sm" variant="light">
                    {row.injury.statusShort}
                  </Badge>
                )}
              </Group>
            </Table.Td>
            <Table.Td>{row.team ?? "—"}</Table.Td>
            <Table.Td>{row.byeWeek ?? "—"}</Table.Td>
            <Table.Td>
              <Badge size="sm" color={positionColorOrDefault(row.position)} variant="light">
                {row.position}
              </Badge>
            </Table.Td>
            <Table.Td>{formatPoints(row.projectedPoints)}</Table.Td>
            <Table.Td>{formatPoints(row.actualPoints)}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
