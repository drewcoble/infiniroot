import {
  ActionIcon,
  Anchor,
  Badge,
  Card,
  Group,
  Menu,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { ChevronDown, ChevronUp, MoreVertical, Trash2 } from "lucide-react";
import type { Doc } from "@infinidata/dataModel";
import { POSITION_COLORS } from "@shared/positionColors";
import type { DraftTierRow } from "../../../types";
import type { StandardValueRow } from "../../../lib/standardValues";
import { StandardValueLabel } from "../../../components/StandardValueLabel";

interface ShortlistRow {
  tag: Doc<"draftPlayerTags">;
  row: DraftTierRow | undefined;
  pick: Doc<"draftPicks"> | undefined;
  draftedByTeam: Doc<"seasonTeams"> | undefined;
}

interface ShortlistTableProps {
  rows: ShortlistRow[];
  onMove: (index: number, delta: number) => void;
  onRemove: (fpid: number) => void;
  onSelectPlayer: (fpid: number) => void;
  standardValueByFpid: Map<number, StandardValueRow>;
}

// Mirrors RecentPicksTable's structure (title + empty state + table props)
// exactly, so the two read as one consistent pair shown side by side on the
// Draft tab. Tagging itself happens elsewhere (Players Left's bar click, or
// the Setup app's Players table) - this is purely for reviewing, reordering,
// and pruning the resulting shortlist.
export function TargetsTable({
  rows,
  onMove,
  onRemove,
  onSelectPlayer,
  standardValueByFpid,
}: ShortlistTableProps) {
  return (
    <Card withBorder padding="md">
      <Stack gap="sm">
        <Text size="sm" fw={500}>
          Targets
        </Text>
        {rows.length === 0 ? (
          <Text size="sm" c="dimmed">
            No targets yet.
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={360}>
            <Table highlightOnHover verticalSpacing={4}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Player</Table.Th>
                  <Table.Th>Value / Status</Table.Th>
                  <Table.Th>vs. market</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map(({ tag, row, pick, draftedByTeam }, index) => (
                  <Table.Tr key={tag.fpid}>
                    <Table.Td>
                      {row ? (
                        <Group gap={6} wrap="wrap">
                          <Anchor
                            component="button"
                            type="button"
                            onClick={() => onSelectPlayer(tag.fpid)}
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
                      ) : (
                        <Text size="sm">#{tag.fpid}</Text>
                      )}
                    </Table.Td>
                    {/* Value + Status merged (was 2 columns) - dollar
                        value/tier on top, drafted/available badge below. */}
                    <Table.Td>
                      <Stack gap={2}>
                        <Text size="sm">
                          {row
                            ? `$${Math.round(row.dollarValue)} · ${row.tierLabel}`
                            : "—"}
                        </Text>
                        {pick ? (
                          <Badge
                            variant="light"
                            color={draftedByTeam?.isSelf ? "blue" : "gray"}
                            style={{ alignSelf: "flex-start" }}
                          >
                            {draftedByTeam?.isSelf
                              ? "You"
                              : (draftedByTeam?.name ?? "Drafted")}{" "}
                            - ${pick.price}
                          </Badge>
                        ) : (
                          <Badge
                            variant="light"
                            color="green"
                            style={{ alignSelf: "flex-start" }}
                          >
                            Available
                          </Badge>
                        )}
                      </Stack>
                    </Table.Td>
                    <Table.Td>
                      <StandardValueLabel
                        draftValue={row?.dollarValue}
                        standardValue={standardValueByFpid.get(tag.fpid)}
                        showLabel={false}
                      />
                    </Table.Td>
                    {/* Reorder + remove merged into one menu (was 2 columns -
                        2 discrete arrow buttons plus a remove button). */}
                    <Table.Td>
                      <Menu shadow="md" width={170} position="bottom-end">
                        <Menu.Target>
                          <ActionIcon
                            variant="subtle"
                            color="gray"
                            aria-label="Target actions"
                          >
                            <MoreVertical size={16} />
                          </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Item
                            leftSection={<ChevronUp size={14} />}
                            disabled={index === 0}
                            onClick={() => onMove(index, -1)}
                          >
                            Move up
                          </Menu.Item>
                          <Menu.Item
                            leftSection={<ChevronDown size={14} />}
                            disabled={index === rows.length - 1}
                            onClick={() => onMove(index, 1)}
                          >
                            Move down
                          </Menu.Item>
                          <Menu.Divider />
                          <Menu.Item
                            color="red"
                            leftSection={<Trash2 size={14} />}
                            onClick={() => onRemove(tag.fpid)}
                          >
                            Remove
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
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
