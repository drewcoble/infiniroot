import {
  Anchor,
  Badge,
  Button,
  Group,
  Modal,
  Stack,
  Text,
} from "@mantine/core";
import type { Doc, Id } from "@infinidata/dataModel";
import { POSITION_COLORS } from "@shared/positionColors";
import { KeeperPriceCell, KeeperTeamCell } from "./KeeperPriceTeamCells";
import { KeeperStreakCell } from "./KeeperStreakInput";

interface KeeperEditModalProps {
  pick: Doc<"draftPicks"> | null;
  playerName: string;
  teams: { _id: Id<"seasonTeams">; name: string }[];
  showStreakInput: boolean;
  onClose: () => void;
  onSetPrice: (pickId: Id<"draftPicks">, price: number) => void;
  onSetRound: (pickId: Id<"draftPicks">, round: number) => void;
  onSetTeam: (pickId: Id<"draftPicks">, teamId: Id<"seasonTeams">) => void;
  onSetStreak: (pickId: Id<"draftPicks">, streak: number) => void;
  onRemove: (pickId: Id<"draftPicks">) => void;
}

// Edit surface for a single keeper's team/price/streak, opened from the
// compact rows in KeeperCardList.tsx instead of exposing an inline dropdown
// + two steppers in every card. Every field here still
// commits immediately per-change through the same mutations those inline
// cells used (setKeeperPrice/setKeeperTeam/setKeeperStreak) - there's
// nothing to save, so Done just closes.
export function KeeperEditModal({
  pick,
  playerName,
  teams,
  showStreakInput,
  onClose,
  onSetPrice,
  onSetRound,
  onSetTeam,
  onSetStreak,
  onRemove,
}: KeeperEditModalProps) {
  return (
    <Modal opened={!!pick} onClose={onClose} title={playerName} size="xs">
      {pick && (
        <Stack gap="md">
          <Badge
            variant="light"
            color={POSITION_COLORS[pick.position]}
            style={{ alignSelf: "flex-start" }}
          >
            {pick.position}
          </Badge>
          <Stack gap={4}>
            <Text size="xs" c="dimmed" fw={500}>
              Team
            </Text>
            <KeeperTeamCell pick={pick} teams={teams} onSetTeam={onSetTeam} />
          </Stack>
          <Stack gap={4}>
            <Text size="xs" c="dimmed" fw={500}>
              {pick.round !== undefined ? "Round" : "Price"}
            </Text>
            <KeeperPriceCell
              pick={pick}
              onSetPrice={onSetPrice}
              onSetRound={onSetRound}
            />
          </Stack>
          {showStreakInput && (
            <Stack gap={4}>
              <Text size="xs" c="dimmed" fw={500}>
                Yrs kept
              </Text>
              <KeeperStreakCell pick={pick} onSetStreak={onSetStreak} />
            </Stack>
          )}
          <Group justify="space-between" mt="sm">
            <Anchor
              component="button"
              type="button"
              c="red"
              size="sm"
              onClick={() => {
                onRemove(pick._id);
                onClose();
              }}
            >
              Remove keeper
            </Anchor>
            <Button size="xs" onClick={onClose}>
              Done
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
