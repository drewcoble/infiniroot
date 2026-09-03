import { Card, Group, Loader, Table, Text } from "@mantine/core";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import type { PowerRankingRow } from "../types/season";

interface PowerRankingsCardProps {
  rows: PowerRankingRow[] | undefined;
}

// Same up/down convention as LineupSuggestionsCard's start/sit arrows -
// green up, red down - plus a dash for "unchanged" and nothing at all when
// there's no prior week to compare against (rankChange absent).
function RankChangeIndicator({ rankChange }: { rankChange: number | undefined }) {
  if (rankChange === undefined) return null;
  if (rankChange === 0) {
    return <Minus size={14} color="var(--mantine-color-dimmed)" />;
  }
  return (
    <Group gap={2} wrap="nowrap">
      {rankChange > 0 ? (
        <ArrowUp size={14} color="var(--mantine-color-green-6)" />
      ) : (
        <ArrowDown size={14} color="var(--mantine-color-red-6)" />
      )}
      <Text size="xs" c={rankChange > 0 ? "green" : "red"} span>
        {Math.abs(rankChange)}
      </Text>
    </Group>
  );
}

// Rest-of-season strength read: each team's optimal-lineup total from the
// current week through week 18 (see convex/infinileague/season/
// powerRankings.ts), as opposed to StandingsTable's backward-looking win/
// loss record just above it on the same page. rankChange is this week's
// rank vs. the last snapshot the backend saved (also powerRankings.ts) -
// absent, not zero, the very first time it's computed for a season.
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
                <Table.Td>
                  <Group gap={6} wrap="nowrap">
                    <Text span>{index + 1}</Text>
                    <RankChangeIndicator rankChange={row.rankChange} />
                  </Group>
                </Table.Td>
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
