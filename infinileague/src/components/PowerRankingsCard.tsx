import { Card, Loader, Table, Text } from "@mantine/core";
import type { PowerRankingRow } from "../types/season";

interface PowerRankingsCardProps {
  rows: PowerRankingRow[] | undefined;
}

// Rest-of-season strength read: each team's optimal-lineup total from the
// current week through week 18 (see convex/infinileague/season/
// powerRankings.ts), as opposed to StandingsTable's backward-looking win/
// loss record just above it on the same page.
export function PowerRankingsCard({ rows }: PowerRankingsCardProps) {
  return (
    <Card withBorder padding="md">
      <Text size="lg" fw={500} mb="sm">
        Power rankings
      </Text>
      {rows === undefined ? (
        <Loader size="sm" />
      ) : (
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>#</Table.Th>
              <Table.Th>Team</Table.Th>
              <Table.Th>Proj. pts (rest of season)</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row, index) => (
              <Table.Tr key={row.teamId}>
                <Table.Td>{index + 1}</Table.Td>
                <Table.Td>{row.name}</Table.Td>
                <Table.Td>{row.totalProjectedPoints.toFixed(1)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Card>
  );
}
