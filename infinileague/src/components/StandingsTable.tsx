import { Anchor, Table, Text } from "@mantine/core";
import { Link } from "@tanstack/react-router";
import type { StandingsRow } from "../types/season";

interface StandingsTableProps {
  leagueId: string;
  rows: StandingsRow[];
  // Which column the last one renders as - chosen once by the season's
  // waiverType, not per-row (see convex/season/standings.ts's comment on
  // why exactly one of faabRemaining/waiverPosition is ever set).
  waiverType: "faab" | "priority" | undefined;
}

// Ranked by win percentage, points scored as tiebreaker - both already
// computed/sorted server-side (see convex/season/standings.ts's
// getStandings), this just renders the rows in the order they arrive.
export function StandingsTable({ leagueId, rows, waiverType }: StandingsTableProps) {
  const waiverColumnLabel = waiverType === "faab" ? "FAAB $" : "Waiver #";

  return (
    <Table highlightOnHover>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>#</Table.Th>
          <Table.Th>Team</Table.Th>
          <Table.Th>W-L-T</Table.Th>
          <Table.Th>PF</Table.Th>
          <Table.Th>PA</Table.Th>
          <Table.Th>{waiverColumnLabel}</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((row) => (
          <Table.Tr key={row.teamId}>
            <Table.Td>{row.rank}</Table.Td>
            <Table.Td>
              <Link
                to="/league/$leagueId/teams/$teamId"
                params={{ leagueId, teamId: row.teamId }}
                style={{ textDecoration: "none" }}
              >
                <Anchor component="span" fw={row.isSelf ? 700 : 400}>
                  {row.name}
                </Anchor>
              </Link>
              {row.isSelf && (
                <Text c="dimmed" size="xs" span ml={6}>
                  (You)
                </Text>
              )}
            </Table.Td>
            <Table.Td>
              {row.wins}-{row.losses}-{row.ties}
            </Table.Td>
            <Table.Td>{row.pointsFor.toFixed(1)}</Table.Td>
            <Table.Td>{row.pointsAgainst.toFixed(1)}</Table.Td>
            <Table.Td>
              {row.faabRemaining !== undefined
                ? `$${row.faabRemaining}`
                : (row.waiverPosition ?? "—")}
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
