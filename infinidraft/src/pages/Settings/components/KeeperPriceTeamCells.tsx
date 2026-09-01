import { Group, Select } from "@mantine/core";
import { Check } from "lucide-react";
import type { Doc, Id } from "@infinidata/dataModel";
import { EditableNumberStepper } from "../../../components/NumberStepper";
import { useSaveFlash } from "../../../hooks/useSaveFlash";

interface KeeperPriceCellProps {
  pick: Doc<"draftPicks">;
  onSetPrice: (pickId: Id<"draftPicks">, price: number) => void;
  // Round-based counterpart to onSetPrice (SNAKE_DRAFT.md §8) - only ever
  // called when pick.round is set, i.e. a snake/linear league's keeper.
  // Optional so callers that only ever handle dollar keepers can omit it.
  onSetRound?: (pickId: Id<"draftPicks">, round: number) => void;
}

// Inline-editable price/round - same "commits immediately, flashes a
// checkmark" pattern as KeeperStreakCell. Branches on pick.round (set only
// for a snake/linear keeper, SNAKE_DRAFT.md §8) rather than a separate
// format flag - a keeper's own row already carries which mode it's in. 0 is
// a valid price (an undrafted/waiver pickup - see keeperCost.ts's
// computeKeeperCost), so no floor there; a round is floored at 1 instead.
export function KeeperPriceCell({
  pick,
  onSetPrice,
  onSetRound,
}: KeeperPriceCellProps) {
  const [showSaved, flashSaved] = useSaveFlash();
  const isRoundBased = pick.round !== undefined;

  return (
    <Group gap={4} wrap="nowrap" align="center">
      <EditableNumberStepper
        label={`${pick.fpid} ${isRoundBased ? "round" : "price"}`}
        min={isRoundBased ? 1 : 0}
        width={80}
        size="xs"
        {...(isRoundBased ? {} : { prefix: "$" })}
        value={isRoundBased ? pick.round : pick.price}
        onChange={(next) => {
          if (next === undefined) return;
          if (isRoundBased) {
            if (next === pick.round) return;
            onSetRound?.(pick._id, next);
          } else {
            if (next === pick.price) return;
            onSetPrice(pick._id, next);
          }
          flashSaved();
        }}
      />
      {showSaved && <Check size={14} color="var(--mantine-color-teal-6)" />}
    </Group>
  );
}

interface KeeperTeamCellProps {
  pick: Doc<"draftPicks">;
  teams: { _id: Id<"seasonTeams">; name: string }[];
  onSetTeam: (pickId: Id<"draftPicks">, teamId: Id<"seasonTeams">) => void;
}

// Inline-editable team assignment - lets a mis-assigned keeper (e.g. a
// Recommended Keepers quick-add whose team-name guess was wrong, or just a
// picker mistake) be corrected without removing and re-adding it.
export function KeeperTeamCell({
  pick,
  teams,
  onSetTeam,
}: KeeperTeamCellProps) {
  const [showSaved, flashSaved] = useSaveFlash();

  return (
    <Group gap={4} wrap="nowrap" align="center">
      <Select
        aria-label="Team"
        size="xs"
        w={150}
        allowDeselect={false}
        data={teams.map((team) => ({ value: team._id, label: team.name }))}
        value={pick.teamId}
        onChange={(value) => {
          if (!value || value === pick.teamId) return;
          onSetTeam(pick._id, value as Id<"seasonTeams">);
          flashSaved();
        }}
      />
      {showSaved && <Check size={14} color="var(--mantine-color-teal-6)" />}
    </Group>
  );
}
