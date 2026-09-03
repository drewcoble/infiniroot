import { Badge, Group, Stack, Table, Text } from "@mantine/core";
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
// SlotTable.tsx, the "My Team" tab) - a tighter verticalSpacing={4} instead
// of Mantine's default spacing, and the slot badge sharing the Player cell
// instead of its own unlabeled leading column. Rows arrive pre-sorted from
// the backend in infinidraft's own canonical slot order (QB, SUPERFLEX, RB,
// WR, FLEX, TE, DST, K, BENCH, IR, TAXI - see convex/season/teamRoster.ts's
// SLOT_ORDER_RANK), rendered as-is. A row with no fpid is an unfilled slot
// (an open bench/taxi spot the league is configured for) - same "badge +
// dimmed em dash" treatment SlotTable uses for an empty draft slot.
//
// Player cell's name + dimmed "pos - team - bye" subtext follows infinidraft's
// pre-draft players table mobile row convention (Settings/components/
// PlayerRowMobile.tsx's `${team} - Tier ${tier}` line), swapping tier for
// position + bye week - which is why Pos/Team/Bye no longer need their own
// columns here. Position renders as plain (non-badge) text colored via
// positionColorOrDefault, unlike the slot label beside it, which stays a
// badge.
// layout="fixed" (rather than Table's own default "auto") + explicit Proj/
// Actual widths so the Player column's truncate below actually clips
// instead of the cell growing to fit its content - text-overflow: ellipsis
// is a no-op under table-layout: auto. maxWidth caps the table itself so it
// never needs Table.ScrollContainer's horizontal scroll.
export function TeamRosterTable({ rows }: TeamRosterTableProps) {
  return (
    <Table
      highlightOnHover
      verticalSpacing={4}
      layout="fixed"
      w="100%"
      withRowBorders={false}
      style={{ maxWidth: 480 }}
    >
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Player</Table.Th>
          <Table.Th w={50}>Proj</Table.Th>
          <Table.Th w={50}>Actual</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((row, index) => (
          <Table.Tr key={row.fpid ?? `empty-${row.slot}-${index}`}>
            <Table.Td>
              <Group gap={6} wrap="nowrap" align="center">
                {row.slot !== undefined && (
                  <Badge size="sm" variant="light" color={positionColorOrDefault(row.slot)}>
                    {row.slot === "BENCH"
                      ? "BN"
                      : row.slot === "TAXI"
                        ? "Taxi"
                        : row.slot === "SUPERFLEX"
                          ? "SFLEX"
                          : row.slot}
                  </Badge>
                )}
                {row.fpid !== undefined ? (
                  <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                    <Group gap={6} wrap="nowrap">
                      <Text span size="sm" truncate style={{ minWidth: 0 }}>
                        {row.name}
                      </Text>
                      {row.isRookie && <RookieBadge />}
                      {row.injury && (
                        <Badge color={injuryColor(row.injury.status)} size="sm" variant="light">
                          {row.injury.statusShort}
                        </Badge>
                      )}
                    </Group>
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
                      {row.byeWeek !== undefined && ` - Bye ${row.byeWeek}`}
                    </Text>
                  </Stack>
                ) : (
                  <Text size="sm" c="dimmed">
                    —
                  </Text>
                )}
              </Group>
            </Table.Td>
            <Table.Td>{formatPoints(row.projectedPoints)}</Table.Td>
            <Table.Td>{formatPoints(row.actualPoints)}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
