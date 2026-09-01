import {
  ActionIcon,
  Anchor,
  Badge,
  Card,
  Group,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { Trash2 } from "lucide-react";
import type { Doc, Id } from "@infinidata/dataModel";

interface RecentPicksTableProps {
  picks: Doc<"draftPicks">[];
  nameByFpid: Map<number, { name: string; team: string | null }>;
  teamNameById: Map<string, string>;
  onRemove: (pickId: Id<"draftPicks">) => void;
  onSelectPlayer: (fpid: number) => void;
  // Gates the "· Yr X" suffix on the Keeper badge below - true when the
  // league has a maxConsecutiveYears cap set (see schema.ts's
  // trackConsecutiveYears comment).
  trackConsecutiveYears: boolean;
}

export function RecentPicksTable({
  picks,
  nameByFpid,
  teamNameById,
  onRemove,
  onSelectPlayer,
  trackConsecutiveYears,
}: RecentPicksTableProps) {
  return (
    <Card withBorder padding="md">
      <Stack gap="sm">
        <Text size="sm" fw={500}>
          Recent picks
        </Text>
        {picks.length === 0 ? (
          <Text size="sm" c="dimmed">
            No picks yet.
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={360}>
            <Table striped highlightOnHover verticalSpacing={4}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Player</Table.Th>
                  <Table.Th>Team</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {picks.map((pick) => (
                  <Table.Tr key={pick._id}>
                    {/* Name + keeper badge merged (was 2 columns) - same
                        compaction as SlotTable.tsx's Player column. */}
                    <Table.Td>
                      <Group gap={6} wrap="wrap">
                        <Anchor
                          component="button"
                          type="button"
                          onClick={() => onSelectPlayer(pick.fpid)}
                        >
                          {nameByFpid.get(pick.fpid)?.name ?? `#${pick.fpid}`}
                        </Anchor>
                        {pick.isKeeper && (
                          <Badge variant="light" color="gray" size="sm">
                            {trackConsecutiveYears
                              ? `Keeper · Yr ${pick.keeperStreak ?? 1}`
                              : "Keeper"}
                          </Badge>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>{teamNameById.get(pick.teamId) ?? "—"}</Table.Td>
                    {/* Price + remove merged (was 2 columns). */}
                    <Table.Td>
                      <Group gap={4} wrap="nowrap" justify="flex-end">
                        <Text size="sm" fw={600}>
                          ${pick.price}
                        </Text>
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          aria-label="Remove pick"
                          onClick={() => onRemove(pick._id)}
                        >
                          <Trash2 size={16} />
                        </ActionIcon>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Stack>
    </Card>
  );
}
