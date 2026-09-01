import { ActionIcon, Anchor, Badge, Group, Stack, Text } from "@mantine/core";
import { Trash2 } from "lucide-react";
import type { Doc, Id } from "@infinidata/dataModel";
import type { SlotDescriptor } from "../lib/rosterSlots";
import { positionColorOrDefault } from "@shared/positionColors";
import { RookieBadge } from "@shared/RookieBadge";
import { useRookieFpids } from "../hooks/useRookieFpids";

interface TeamSlotDetailProps {
  slots: SlotDescriptor[];
  bySlot: Map<string, Doc<"draftPicks">>;
  nameByFpid: Map<number, { name: string; team: string | null }>;
  onRemove?: (pickId: Id<"draftPicks">) => void;
  onSelectPlayer?: (fpid: number) => void;
  // Gates the "· Yr X" suffix on the Keeper badge below - true when the
  // league has a maxConsecutiveYears cap set (see schema.ts's
  // trackConsecutiveYears comment).
  trackConsecutiveYears: boolean;
}

// Expandable per-slot roster breakdown for one team - used by both the live
// Draft Room's LeagueTab (with a Remove action) and Settings' SeasonSummary
// (read-only, for a past season, which passes no onRemove at all), so it
// lives in the shared components/ folder rather than either page. Slot
// assignment itself is always computed fresh by points elsewhere (see
// src/lib/slotAssignment.ts's optimalAssignPicksToSlots) - there's no manual
// move affordance anymore, so this only ever needs to render whatever `bySlot`
// it's handed.
export function TeamSlotDetail({
  slots,
  bySlot,
  nameByFpid,
  onRemove,
  onSelectPlayer,
  trackConsecutiveYears,
}: TeamSlotDetailProps) {
  const rookieFpids = useRookieFpids();
  return (
    <Stack gap={10} mt="xs">
      {slots.map((slot) => {
        const pick = bySlot.get(slot.key);
        const player = pick ? nameByFpid.get(pick.fpid) : undefined;
        const hasActions = pick && onRemove;
        return (
          <Group
            key={slot.key}
            justify="space-between"
            gap="xs"
            wrap="nowrap"
            mih={36}
          >
            <Badge
              variant="light"
              size="sm"
              color={positionColorOrDefault(slot.label)}
            >
              {slot.label}
            </Badge>
            <Group gap={4} wrap="wrap" style={{ flex: 1, minWidth: 0 }}>
              <Text size="xs" c="dimmed">
                {player && pick && onSelectPlayer ? (
                  <Anchor
                    component="button"
                    type="button"
                    size="xs"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectPlayer(pick.fpid);
                    }}
                  >
                    {player.name}
                  </Anchor>
                ) : (
                  (player?.name ?? "—")
                )}
                {pick && rookieFpids.has(pick.fpid) && <RookieBadge />}
                {/* Auction-only display (SNAKE_DRAFT.md §3.4) - price is
                    undefined for a snake/linear pick, so this is omitted
                    rather than showing "$undefined". */}
                {pick && pick.price !== undefined ? ` · $${pick.price}` : ""}
              </Text>
              {pick?.isKeeper && (
                <Badge variant="light" color="gray" size="sm">
                  {trackConsecutiveYears
                    ? `Keeper · Yr ${pick.keeperStreak ?? 1}`
                    : "Keeper"}
                </Badge>
              )}
            </Group>
            {hasActions && (
              <ActionIcon
                variant="subtle"
                color="red"
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove(pick._id);
                }}
                aria-label="Remove pick"
              >
                <Trash2 size={16} />
              </ActionIcon>
            )}
          </Group>
        );
      })}
    </Stack>
  );
}
