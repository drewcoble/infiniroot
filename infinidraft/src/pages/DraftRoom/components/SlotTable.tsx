import {
  ActionIcon,
  Anchor,
  Badge,
  Group,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { Trash2 } from "lucide-react";
import type { Doc, Id } from "@infinidata/dataModel";
import type { SlotDescriptor } from "../../../lib/rosterSlots";
import { positionColorOrDefault } from "@shared/positionColors";
import { RookieBadge } from "@shared/RookieBadge";
import { useRookieFpids } from "../../../hooks/useRookieFpids";

interface SlotTableProps {
  slots: SlotDescriptor[];
  pickBySlotKey: Map<string, Doc<"draftPicks">>;
  planAmounts: Record<string, number>;
  nameByFpid: Map<number, { name: string; team: string | null }>;
  onRemove: (pickId: Id<"draftPicks">) => void;
  onSelectPlayer: (fpid: number) => void;
  // Gates the "· Yr X" suffix on the Keeper badge below - true when the
  // league has a maxConsecutiveYears cap set (see schema.ts's
  // trackConsecutiveYears comment).
  trackConsecutiveYears: boolean;
  // Auction: $ price/plan/diff in the second column, as before. Snake/
  // linear: no budget concept at all (SNAKE_DRAFT.md §3.4), so that column
  // shows when/where the pick was actually made (round.pickInRound) instead
  // of a permanently-"$0" budget column - see MyTeamTab.tsx's own comment on
  // why this needed a real branch rather than just hiding the column blank.
  isAuction: boolean;
}

export function SlotTable({
  slots,
  pickBySlotKey,
  planAmounts,
  nameByFpid,
  onRemove,
  onSelectPlayer,
  trackConsecutiveYears,
  isAuction,
}: SlotTableProps) {
  const rookieFpids = useRookieFpids();
  return (
    <Table.ScrollContainer minWidth={340}>
      <Table highlightOnHover verticalSpacing={4}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Player</Table.Th>
            <Table.Th>{isAuction ? "Budget" : "Drafted"}</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {slots.map((slot) => {
            const pick = pickBySlotKey.get(slot.key);
            const player = pick ? nameByFpid.get(pick.fpid) : undefined;
            const planAmount = planAmounts[slot.key] ?? 0;
            // Budget planning is auction-only (SNAKE_DRAFT.md §3.4).
            const diff = pick ? planAmount - (pick.price ?? 0) : 0;
            const draftedAt =
              pick?.round !== undefined && pick.pickInRound !== undefined
                ? `${pick.round}.${String(pick.pickInRound).padStart(2, "0")}`
                : pick
                  ? `#${pick.sequence}`
                  : "—";
            return (
              <Table.Tr key={slot.key}>
                {/* Slot badge + player name + keeper badge all in one cell
                    (was 2 separate columns) - same compaction as
                    KeeperCardList.tsx's player row. */}
                <Table.Td>
                  <Group gap={6} wrap="nowrap" align="center">
                    <Badge
                      size="sm"
                      variant="light"
                      color={positionColorOrDefault(slot.label)}
                    >
                      {slot.label}
                    </Badge>
                    {player && pick ? (
                      // Keeper badge always stacks under the name (rather
                      // than sharing the row with the position badge and
                      // wrapping onto its own line only once it runs out of
                      // room) so the position badge stays vertically
                      // centered against a consistent 1- or 2-line block
                      // instead of drifting depending on wrap width.
                      <Stack gap={2}>
                        <Group gap={6} wrap="nowrap">
                          <Anchor
                            component="button"
                            type="button"
                            size="sm"
                            onClick={() => onSelectPlayer(pick.fpid)}
                          >
                            {player.name}
                          </Anchor>
                          {rookieFpids.has(pick.fpid) && <RookieBadge />}
                        </Group>
                        {pick.isKeeper && (
                          <Badge
                            variant="light"
                            color="gray"
                            size="sm"
                            style={{ alignSelf: "flex-start" }}
                          >
                            {trackConsecutiveYears
                              ? `Keeper · Yr ${pick.keeperStreak ?? 1}`
                              : "Keeper"}
                          </Badge>
                        )}
                      </Stack>
                    ) : (
                      <Text size="sm" c="dimmed">
                        —
                      </Text>
                    )}
                  </Group>
                </Table.Td>
                {/* Plan/Paid/+- collapsed into one cell (was 3 separate
                    columns) - paid price up top, plan + the colored
                    over/under diff as a smaller line underneath. Snake/
                    linear has no plan/price to collapse, so it's just the
                    round.pick this slot was actually drafted at. */}
                <Table.Td>
                  {isAuction ? (
                    <Stack gap={0}>
                      <Text size="sm" fw={600}>
                        {pick && pick.price !== undefined
                          ? `$${pick.price}`
                          : "—"}
                      </Text>
                      <Text
                        size="xs"
                        c={diff > 0 ? "green" : diff < 0 ? "red" : "dimmed"}
                      >
                        plan ${planAmount}
                        {pick && diff !== 0
                          ? ` (${diff > 0 ? `+${diff}` : diff})`
                          : ""}
                      </Text>
                    </Stack>
                  ) : (
                    <Text size="sm" fw={600}>
                      {draftedAt}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  {pick && (
                    <Group gap={4} wrap="nowrap" justify="flex-end">
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        aria-label="Remove pick"
                        onClick={() => onRemove(pick._id)}
                      >
                        <Trash2 size={16} />
                      </ActionIcon>
                    </Group>
                  )}
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
