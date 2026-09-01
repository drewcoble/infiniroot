import { ActionIcon, Group, Text } from "@mantine/core";
import { GripVertical, Trash2 } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Doc } from "@infinidata/dataModel";
import { TeamNameField } from "./TeamNameField";
import { TeamSalaryCapField } from "./TeamSalaryCapField";

interface TeamOrderRowProps {
  team: Doc<"seasonTeams">;
  index: number;
  salaryCap: number;
  editingCaps: boolean;
  reordering: boolean;
  removing: boolean;
  onRename: (name: string) => void;
  onSetSalaryCap: (cap: number | null) => void;
  onRequestRemove: () => void;
  // False for a snake/linear season (SNAKE_DRAFT.md §2.1) - per-team salary
  // cap overrides aren't applicable outside auction, so the field is hidden
  // entirely rather than just non-editable.
  showSalaryCap?: boolean;
}

// Always sortable (see TeamsPanel's DndContext/SortableContext), but drag
// only ever starts from the grip handle, and the handle - along with drag
// activation itself - only exists while `reordering` is true. That keeps
// this row itself simple (no conditional hook calls) while still making
// dragging fully unavailable outside reorder mode, same as the old
// up/down arrows being absent outside... except those existed unconditionally
// before; this replaces them entirely rather than just hiding them.
export function TeamOrderRow({
  team,
  index,
  salaryCap,
  editingCaps,
  reordering,
  removing,
  onRename,
  onSetSalaryCap,
  onRequestRemove,
  showSalaryCap = true,
}: TeamOrderRowProps) {
  const {
    setNodeRef,
    transform,
    transition,
    attributes,
    listeners,
    isDragging,
  } = useSortable({ id: team._id, disabled: !reordering });

  return (
    <Group
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      gap="xs"
      wrap="nowrap"
    >
      {/* Right-aligned in a fixed-width box (rather than left-aligned) so
          "10"'s extra digit doesn't shift every field after it out of
          alignment with the single-digit rows above/below it. */}
      <Text size="sm" w={22} ta="right" c="dimmed">
        {index + 1}
      </Text>
      <TeamNameField team={team} onRename={onRename} />
      {showSalaryCap && (
        <TeamSalaryCapField
          team={team}
          leagueSalaryCap={salaryCap}
          editing={editingCaps}
          onSetSalaryCap={onSetSalaryCap}
        />
      )}
      {reordering && (
        <ActionIcon
          variant="subtle"
          color="gray"
          size={40}
          style={{ cursor: "grab", touchAction: "none" }}
          aria-label={`Drag to reorder ${team.name}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={16} />
        </ActionIcon>
      )}
      {removing && !team.isSelf && (
        <ActionIcon
          variant="subtle"
          color="red"
          size={40}
          aria-label={`Remove ${team.name}`}
          onClick={onRequestRemove}
        >
          <Trash2 size={16} />
        </ActionIcon>
      )}
    </Group>
  );
}
