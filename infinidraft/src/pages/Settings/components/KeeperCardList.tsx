import { useMemo } from "react";
import {
  ActionIcon,
  Anchor,
  Badge,
  Card,
  Divider,
  Group,
  Stack,
  Text,
} from "@mantine/core";
import { Pencil, Trash2 } from "lucide-react";
import type { Doc, Id } from "@infinidata/dataModel";
import { POSITION_COLORS } from "@shared/positionColors";
import { STEPPER_BUTTON_SIZE } from "../../../constants/general";
import { formatSignedDollar, keeperValueColor } from "../../../lib/keeperValue";
import { RookieBadge } from "@shared/RookieBadge";

interface KeeperCardListProps {
  keepers: Doc<"draftPicks">[];
  nameByFpid: Map<number, { name: string; team: string | null }>;
  rookieFpids: Set<number>;
  teams: { _id: Id<"seasonTeams">; name: string }[];
  // This year's fair-market price per player, used to compute each
  // keeper's value (fair price - what's actually being paid to keep them).
  draftValueByFpid: Map<number, { dollarValue: number }>;
  onRemove: (pickId: Id<"draftPicks">) => void;
  onEdit: (pick: Doc<"draftPicks">) => void;
  onSelectPlayer: (fpid: number) => void;
  // Gates the "Yrs kept" line below - true when the league has a
  // maxConsecutiveYears cap set (see schema.ts's trackConsecutiveYears
  // comment).
  showStreakInput: boolean;
  // A snake/linear league's keeper cost is a draft-slot round, not a
  // dollar price (SNAKE_DRAFT.md §8) - a round has no dollarValue-vs-cost
  // "savings" equivalent yet, so the $ totals/value lines below are
  // dollar-mode only.
  isSnakeOrLinear: boolean;
}

// Renders every keeper as one card per team (used at every breakpoint - see
// KeepersTab.tsx), each kept player a row inside that team's card rather
// than its own card, so adding a second keeper to a team grows the existing
// card instead of adding a new one. Deliberately a compact read-only
// summary rather than inline dropdowns/steppers per row - team/price/streak
// are all edited through KeeperEditModal.tsx instead, opened via the pencil
// icon here. Roster slot assignment isn't shown at all anymore - now that
// My Team is browsable pre-draft too, that's handled there instead of
// duplicating a slot picker on this page.
export function KeeperCardList({
  keepers,
  nameByFpid,
  rookieFpids,
  teams,
  draftValueByFpid,
  onRemove,
  onEdit,
  onSelectPlayer,
  showStreakInput,
  isSnakeOrLinear,
}: KeeperCardListProps) {
  const keepersByTeamId = useMemo(() => {
    const map = new Map<Id<"seasonTeams">, Doc<"draftPicks">[]>();
    for (const pick of keepers) {
      const list = map.get(pick.teamId);
      if (list) {
        list.push(pick);
      } else {
        map.set(pick.teamId, [pick]);
      }
    }
    return map;
  }, [keepers]);

  if (keepers.length === 0) return null;

  return (
    <Stack gap="sm">
      {teams.map((team) => {
        const teamKeepers = keepersByTeamId.get(team._id);
        if (!teamKeepers || teamKeepers.length === 0) return null;

        // Dollar keeper cost is per-player - a round-based league has no
        // dollarValue-vs-cost "savings" equivalent yet (isSnakeOrLinear
        // above), so these totals are dollar-mode only.
        const totalCost = teamKeepers.reduce(
          (sum, pick) => sum + (pick.price ?? 0),
          0,
        );
        const totalValue = teamKeepers.reduce(
          (sum, pick) =>
            sum +
            ((draftValueByFpid.get(pick.fpid)?.dollarValue ?? 0) -
              (pick.price ?? 0)),
          0,
        );

        return (
          <Card key={team._id} withBorder padding="md">
            <Stack gap={2} mb={6}>
              <Text size="sm" fw={600}>
                {team.name}
              </Text>
              <Group gap={6} wrap="wrap">
                <Text size="sm" c="dimmed">
                  {teamKeepers.length} keeper
                  {teamKeepers.length === 1 ? "" : "s"}
                  {isSnakeOrLinear ? "" : ` · $${totalCost}`}
                </Text>
                {!isSnakeOrLinear && (
                  <Text size="sm" fw={600} c={keeperValueColor(totalValue)}>
                    {formatSignedDollar(totalValue)} value
                  </Text>
                )}
              </Group>
            </Stack>
            <Stack gap={6}>
              {teamKeepers.map((pick, index) => {
                const streak = pick.keeperStreak ?? 1;
                const value =
                  (draftValueByFpid.get(pick.fpid)?.dollarValue ?? 0) -
                  (pick.price ?? 0);
                return (
                  <Stack key={pick._id} gap={0}>
                    {index > 0 && <Divider mb={6} />}
                    <Group justify="space-between" wrap="nowrap" align="center">
                      <Group gap={6} wrap="wrap" style={{ minWidth: 0 }}>
                        <Badge
                          size="sm"
                          variant="light"
                          color={POSITION_COLORS[pick.position]}
                        >
                          {pick.position}
                        </Badge>
                        <Anchor
                          component="button"
                          type="button"
                          size="sm"
                          fw={500}
                          onClick={() => onSelectPlayer(pick.fpid)}
                        >
                          {nameByFpid.get(pick.fpid)?.name ?? `#${pick.fpid}`}
                        </Anchor>
                        {rookieFpids.has(pick.fpid) && <RookieBadge />}
                      </Group>
                      <Group gap={4} wrap="nowrap">
                        <ActionIcon
                          size={STEPPER_BUTTON_SIZE}
                          variant="subtle"
                          color="gray"
                          aria-label="Edit keeper"
                          onClick={() => onEdit(pick)}
                        >
                          <Pencil size={16} />
                        </ActionIcon>
                        <ActionIcon
                          size={STEPPER_BUTTON_SIZE}
                          variant="subtle"
                          color="red"
                          aria-label="Remove keeper"
                          onClick={() => onRemove(pick._id)}
                        >
                          <Trash2 size={16} />
                        </ActionIcon>
                      </Group>
                    </Group>
                    <Group gap={6} wrap="wrap" mt={4}>
                      <Text size="sm" c="dimmed">
                        {isSnakeOrLinear ? `Round ${pick.round ?? "?"}` : `$${pick.price ?? 0}`}
                        {showStreakInput
                          ? ` · ${streak} yr${streak === 1 ? "" : "s"} kept`
                          : ""}
                      </Text>
                      {!isSnakeOrLinear && (
                        <Text size="sm" c={keeperValueColor(value)}>
                          {formatSignedDollar(value)} value
                        </Text>
                      )}
                    </Group>
                  </Stack>
                );
              })}
            </Stack>
          </Card>
        );
      })}
    </Stack>
  );
}
